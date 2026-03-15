/**
 * 模拟用户对话脚本：调用后端 API，用大模型生成“用户”的下一句，与疗愈助手多轮对话，用于测试应用效果。
 *
 * 使用前：
 * 1. 确保后端已启动（默认 http://127.0.0.1:8000）
 * 2. 在项目根目录创建或编辑 .env，配置：
 *    - API_BASE_URL（可选，默认 http://127.0.0.1:8000）
 *    - TEST_USERNAME / TEST_PASSWORD（测试账号，不存在会自动注册）
 *    - OPENROUTER_API_KEY 或 OPENAI_API_KEY（用于生成模拟用户消息的大模型）
 *    - FIRST_MESSAGE（可选，第一句用户话，默认见下方）
 *    - SIMULATE_TURNS（可选，对话轮数，默认 5）
 *
 * 运行：npm run simulate-chat  或  node scripts/simulate-chat.js
 */

import { config } from "dotenv";

config(); // 从项目根目录加载 .env

const API_BASE = process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const TEST_USERNAME = process.env.TEST_USERNAME || "sim_user";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "sim_pass_123";
const FIRST_MESSAGE =
  process.env.FIRST_MESSAGE || "最近睡眠不好，总是梦到以前的事，白天也容易闪回。";
const TURNS = Math.max(1, parseInt(process.env.SIMULATE_TURNS || "5", 10));

// 生成模拟用户消息用的大模型配置（OpenRouter 或 OpenAI）
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const LLM_MODEL = process.env.SIMULATE_LLM_MODEL || "deepseek/deepseek-chat";

function getLLMConfig() {
  if (OPENROUTER_API_KEY) {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: OPENROUTER_API_KEY,
      model: LLM_MODEL,
    };
  }
  if (OPENAI_API_KEY) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: OPENAI_API_KEY,
      model: process.env.SIMULATE_LLM_MODEL || "gpt-4o-mini",
    };
  }
  return null;
}

async function registerOrLogin() {
  const registerRes = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  if (registerRes.ok) {
    const data = await registerRes.json();
    console.log("[模拟脚本] 已注册并登录:", data.user?.username);
    return { token: data.token, userId: data.user?.id };
  }
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  if (!loginRes.ok) {
    const text = await loginRes.text();
    throw new Error(`登录失败: ${loginRes.status} ${text}`);
  }
  const data = await loginRes.json();
  console.log("[模拟脚本] 已登录:", data.user?.username);
  return { token: data.token, userId: data.user?.id };
}

async function sendChat(token, userId, message) {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ user_id: userId, message }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`对话请求失败: ${res.status} ${text}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("无响应体");
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const t = line.slice(6).trim();
        if (t) full += t;
      }
      if (line.startsWith("event: end")) return full;
    }
  }
  return full;
}

async function generateNextUserMessage(llm, history) {
  const messages = [
    {
      role: "system",
      content: `你正在扮演一位与 CPTSD 疗愈助手对话的用户（假设你有心理创伤，比如童年遭受虐待或者情感忽视等，现在有创伤后应激障碍，或者因为心理原因身处痛苦之中）。根据助手上一条回复，生成一句简短、自然的用户回复（1～2 句话，中文）。只输出用户说的话，不要引号、不要解释。`,
    },
    ...history.map((h) => ({ role: h.role === "user" ? "user" : "assistant", content: h.content })),
  ];
  const res = await fetch(llm.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llm.apiKey}`,
    },
    body: JSON.stringify({
      model: llm.model,
      messages,
      max_tokens: 150,
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`大模型请求失败: ${res.status} ${text}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("大模型未返回内容");
  return content;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[模拟脚本] API 地址:", API_BASE);
  console.log("[模拟脚本] 对话轮数:", TURNS);
  const llm = getLLMConfig();
  if (!llm) {
    console.error("[模拟脚本] 请设置 OPENROUTER_API_KEY 或 OPENAI_API_KEY 以生成模拟用户消息。");
    process.exit(1);
  }

  const { token, userId } = await registerOrLogin();
  const history = [];
  let nextUserMessage = FIRST_MESSAGE;

  for (let i = 0; i < TURNS; i++) {
    console.log("\n--- 第", i + 1, "轮 ---");
    console.log("用户:", nextUserMessage);
    history.push({ role: "user", content: nextUserMessage });

    const assistantReply = await sendChat(token, userId, nextUserMessage);
    console.log("助手:", assistantReply);
    history.push({ role: "assistant", content: assistantReply });

    if (i < TURNS - 1) {
      nextUserMessage = await generateNextUserMessage(llm, history);
      await sleep(300);
    }
  }
  console.log("\n[模拟脚本] 对话结束。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
