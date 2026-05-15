/**
 * 模拟用户对话脚本：调用后端 API，用大模型生成“用户”的下一句，与疗愈助手多轮对话，用于测试应用效果。
 *
 * 使用前：
 * 1. 确保后端已启动（默认 http://127.0.0.1:8000）
 * 2. 在项目根目录创建或编辑 .env，配置：
 *    - API_BASE_URL（可选，默认 http://127.0.0.1:8000）
 *    - TEST_USERNAME / TEST_PASSWORD（测试账号，不存在会自动注册）
 *    - OPENROUTER_API_KEY（用于生成模拟用户消息的大模型，仅 OpenRouter）
 *    - FIRST_MESSAGE（可选；仅当数据库中没有任何历史消息时作为第一句，默认见下方）
 *    - SIMULATE_TURNS（可选，对话轮数，默认 5）
 *    - SIMULATE_HISTORY_MAX_MESSAGES（可选，载入历史时最多保留多少条消息参与生成，0=不截断；过长时保留最新 N 条）
 *    - SIMULATE_MAX_TOKENS（可选，默认 512；若路由返回空 content 可适当加大）
 *    - SIMULATE_OPENROUTER_MIDDLE_OUT（可选，设为 1 才开启 middle-out；默认关闭，避免部分路由流式返回空）
 *    - SIMULATE_OPENROUTER_PROVIDER_IGNORE（可选，逗号分隔 OpenRouter 要忽略的 provider；默认 DeepInfra。设为 none 或 false 则不忽略）
 *    - SIMULATE_STRUCTURED_MESSAGES（可选，设为 1 时对 OpenRouter 使用 system+多轮消息；默认 0，使用单条 user 整段文本，与后端对话请求风格一致，避免多供应商返回空 delta）
 *
 * OpenRouter：模拟用户 LLM 请求与后端一致使用 **stream=true**，从 SSE 的 delta.content 拼正文（避免部分路由非流式 message.content=null）。
 *
 * 行为说明：
 * - 登录后会分页拉取该用户在数据库中的全部历史消息。
 * - 若已有历史：第一句用户话也由大模型根据「纯历史」生成（自然接续会话）。
 * - 若无历史：第一句使用 FIRST_MESSAGE。
 * - 之后每一句：把「历史 + 本次脚本内新产生的对话」一并作为上下文再生成。
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
const HISTORY_MAX = parseInt(process.env.SIMULATE_HISTORY_MAX_MESSAGES || "0", 10);
/** 模拟用户 LLM 单次生成的上限；过小或部分路由（如 DeepSeek@DeepInfra）会返回 content=null + completion_tokens=1 */
const SIMULATE_MAX_TOKENS = Math.max(64, parseInt(process.env.SIMULATE_MAX_TOKENS || "512", 10));

/**
 * OpenRouter 可为同一 model 选不同上游；DeepInfra 对部分多轮请求会返回 delta.content 恒为空字符串。
 * 文档：https://openrouter.ai/docs/features/provider-routing
 */
function getOpenRouterProviderRouting() {
  const raw = process.env.SIMULATE_OPENROUTER_PROVIDER_IGNORE;
  if (raw === undefined) {
    return { ignore: ["DeepInfra"] };
  }
  const t = String(raw).trim().toLowerCase();
  if (t === "" || t === "none" || t === "false" || t === "0") {
    return {};
  }
  return {
    ignore: String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

// 生成模拟用户消息：仅 OpenRouter（与后端 FastAPI 的 LLM 配置一致）
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim();
const LLM_MODEL = process.env.SIMULATE_LLM_MODEL || "deepseek/deepseek-chat";

function getLLMConfig() {
  if (!OPENROUTER_API_KEY) return null;
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: OPENROUTER_API_KEY,
    model: LLM_MODEL,
  };
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

/**
 * 分页拉取该用户全部历史消息（时间正序：最早 → 最晚）。
 * 后端 GET /api/messages：无 before 时返回「最近」一页；before 取本页最小 id 可继续向更早翻页。
 */
async function fetchAllMessages(token, userId) {
  const limit = 100;
  let before = null;
  /** @type {Array<{role: string, content: string}>} */
  const chronological = [];

  while (true) {
    const params = new URLSearchParams({ user_id: userId, limit: String(limit) });
    if (before != null) params.set("before", String(before));

    const res = await fetch(`${API_BASE}/api/messages?${params}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`拉取历史消息失败: ${res.status} ${text}`);
    }
    const data = await res.json();
    const batch = data.messages || [];
    if (batch.length === 0) break;

    // 本页内已是时间正序；整页比已合并的块更早，拼到前面
    chronological.unshift(...batch);
    if (!data.hasMore) break;
    before = batch[0].id;
  }

  const mapped = chronological.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  if (HISTORY_MAX > 0 && mapped.length > HISTORY_MAX) {
    console.log(
      `[模拟脚本] 历史消息共 ${mapped.length} 条，按 SIMULATE_HISTORY_MAX_MESSAGES=${HISTORY_MAX} 仅保留最新 ${HISTORY_MAX} 条参与生成。`
    );
    return mapped.slice(-HISTORY_MAX);
  }

  console.log(`[模拟脚本] 已加载历史消息 ${mapped.length} 条（用于生成模拟用户话）。`);
  return mapped;
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

function buildUserSimulatorSystemPrompt(opening) {
  const base = `你正在扮演一位与 CPTSD 疗愈助手对话的用户（假设你有心理创伤，比如童年遭受虐待或者情感忽视等，现在有创伤后应激障碍，或者因为心理原因身处痛苦之中）。`;
  if (opening) {
    return `${base}

下面是该用户与疗愈助手**以往的全部对话记录**（按时间顺序）。请**只根据这些历史**，写出用户接下来要说的**第一句**话：要自然接续当前话题与情绪，1～2 句话，中文。若最后一条是助手，请作为用户对助手作出回应；若最后一条是用户，可顺着补充或开启下一小段表达。
只输出用户说的话，不要引号、不要解释。`;
  }
  return `${base}

下面包含「历史对话」以及「本次脚本里刚产生的对话」。请结合完整上下文，尤其是助手上一条回复，生成一句简短、自然的用户回复（1～2 句话，中文）。只输出用户说的话，不要引号、不要解释。`;
}

/**
 * 非流式 JSON：兼容多种 chat/completions 返回形状（历史遗留；当前脚本对模拟用户侧仅走 OpenRouter 流式）。
 */
function extractChatCompletionText(data) {
  const choice = data?.choices?.[0];
  if (!choice) return "";

  if (typeof choice.text === "string" && choice.text.trim()) {
    return choice.text.trim();
  }

  const msg = choice.message;
  if (!msg) return "";

  const c = msg.content;
  if (typeof c === "string" && c.trim()) return c.trim();
  if (Array.isArray(c)) {
    const joined = c
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && part.text) return part.text;
        if (part?.text) return part.text;
        return "";
      })
      .join("");
    if (joined.trim()) return joined.trim();
  }

  if (typeof msg.refusal === "string" && msg.refusal.trim()) return msg.refusal.trim();
  if (typeof msg.reasoning === "string" && msg.reasoning.trim()) return msg.reasoning.trim();

  return "";
}

/** 从流式 delta 里抠出可拼接的正文（兼容 string / 数组片段） */
function appendDeltaText(delta, fullRef) {
  if (!delta) return;
  const c = delta.content;
  if (typeof c === "string" && c) {
    fullRef.s += c;
    return;
  }
  if (Array.isArray(c)) {
    for (const part of c) {
      if (typeof part === "string") fullRef.s += part;
      else if (part?.type === "text" && part.text) fullRef.s += part.text;
      else if (part?.text) fullRef.s += part.text;
    }
  }
}

/**
 * 与后端 app/llm.py::_stream_chat_openrouter 一致：stream=true，按 SSE 解析 data 行。
 * 同时兼容：delta.content 为数组、message 增量、OpenRouter 错误包。
 * @returns {{ text: string, rawSsePreview: string }}
 */
async function accumulateOpenRouterStreamText(res) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("OpenRouter 流式响应无 body");
  const decoder = new TextDecoder();
  let buffer = "";
  const fullRef = { s: "" };
  let rawAccum = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    if (rawAccum.length < 8000) rawAccum += chunk;

    while (buffer.includes("\n")) {
      const nl = buffer.indexOf("\n");
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      line = line.replace(/\r$/, "").trim();
      if (!line) continue;
      if (line === "data: [DONE]") continue;
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      try {
        const data = JSON.parse(payload);
        if (data.error) {
          const msg = data.error?.message || JSON.stringify(data.error);
          throw new Error(`OpenRouter 流式错误: ${msg}`);
        }
        const ch = data?.choices?.[0];
        const delta = ch?.delta;
        appendDeltaText(delta, fullRef);
        // 少数实现会在流里带 message 片段
        const msg = ch?.message;
        if (msg && typeof msg.content === "string" && msg.content) fullRef.s += msg.content;
        if (msg && Array.isArray(msg.content)) {
          appendDeltaText({ content: msg.content }, fullRef);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("OpenRouter 流式错误")) throw e;
        // 与后端一致：忽略单行 JSON 解析失败
      }
    }
  }

  if (buffer.trim()) {
    const line = buffer.replace(/\r$/, "").trim();
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const data = JSON.parse(line.slice(6).trim());
        if (data.error) {
          const msg = data.error?.message || JSON.stringify(data.error);
          throw new Error(`OpenRouter 流式错误: ${msg}`);
        }
        appendDeltaText(data?.choices?.[0]?.delta, fullRef);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("OpenRouter 流式错误")) throw e;
      }
    }
  }

  let text = fullRef.s.trim();

  // 少数情况下上游返回整段 JSON（非 SSE），或流里未带 data: 行
  if (!text && rawAccum.trim().startsWith("{")) {
    try {
      const data = JSON.parse(rawAccum.trim());
      if (data.error) {
        const msg = data.error?.message || JSON.stringify(data.error);
        throw new Error(`OpenRouter 返回错误: ${msg}`);
      }
      text = extractChatCompletionText(data);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("OpenRouter 返回错误")) throw e;
    }
  }

  return { text, rawSsePreview: rawAccum.slice(0, 6000) };
}

/**
 * 构建一次 chat 请求的 messages 数组
 * @param {Array<{role: string, content: string}>} historySlice
 */
function buildChatMessages(opening, historySlice) {
  return [
    {
      role: "system",
      content: buildUserSimulatorSystemPrompt(opening),
    },
    ...historySlice.map((h) => ({
      role: h.role === "user" ? "user" : "assistant",
      content: h.content,
    })),
  ];
}

/**
 * OpenRouter / 多供应商下，system + 多轮 role 易导致 delta.content 恒为空。
 * 与后端 stream_chat 一致：单条 user，把说明与对话全文拼进一条（见 app/llm.py）。
 */
function buildOpenRouterFlattenedUserMessages(opening, historySlice) {
  const transcript = historySlice
    .map((h) => {
      const label = h.role === "user" ? "用户" : "疗愈助手";
      return `${label}：${h.content}`;
    })
    .join("\n\n");

  const persona =
    "你正在扮演一位与 CPTSD 疗愈助手对话的用户（假设你有心理创伤，比如童年遭受虐待或者情感忽视等，现在有创伤后应激障碍，或者因为心理原因身处痛苦之中）。";

  if (opening) {
    const content = `${persona}

下面是该用户与疗愈助手以往的全部对话记录（按时间顺序）：

---
${transcript}
---

请只根据以上历史，写出该用户接下来要说的【第一句话】（1～2 句中文，自然接续）。只输出用户说的话，不要引号、不要解释。`;
    return [{ role: "user", content }];
  }

  const content = `${persona}

下面是历史对话与当前这一段的完整记录（按时间顺序）：

---
${transcript}
---

请结合上下文，尤其是疗愈助手的上一条回复，写出该用户接下来要说的【下一句话】（1～2 句中文）。只输出用户说的话，不要引号、不要解释。`;
  return [{ role: "user", content }];
}

/**
 * @param {boolean} [opening] - true：仅根据 fullHistory 生成会话开场下一句（用于有历史时的第一句）
 */
async function generateNextUserMessage(llm, fullHistory, { opening = false } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${llm.apiKey}`,
    "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "https://github.com/safebase",
    "X-Title": process.env.OPENROUTER_APP_TITLE || "simulate-chat",
    Accept: "text/event-stream",
  };

  /** 重试策略：全量 → 截断最近 N 条 → 再截更短；middle-out 默认关闭（易导致流式空响应） */
  const truncateSteps = [null, 40, 20];
  const useMiddleOut = process.env.SIMULATE_OPENROUTER_MIDDLE_OUT === "1";

  /** @type {unknown} */
  let lastFailedPayload = null;

  for (let attempt = 0; attempt < truncateSteps.length; attempt++) {
    const maxMsgs = truncateSteps[attempt];
    let slice = fullHistory;
    if (maxMsgs != null && fullHistory.length > maxMsgs) {
      slice = fullHistory.slice(-maxMsgs);
      console.warn(
        `[模拟脚本] 第 ${attempt + 1} 次尝试：仅使用最近 ${maxMsgs} 条消息作为上下文（避免部分路由返回空 content）。`
      );
    }

    const useStructuredOpenRouter = process.env.SIMULATE_STRUCTURED_MESSAGES === "1";
    const messages = !useStructuredOpenRouter
      ? buildOpenRouterFlattenedUserMessages(opening, slice)
      : buildChatMessages(opening, slice);
    if (attempt === 0) {
      if (useStructuredOpenRouter) {
        console.log("[模拟脚本] OpenRouter 使用 system+多轮消息（SIMULATE_STRUCTURED_MESSAGES=1）");
      } else {
        console.log(
          "[模拟脚本] OpenRouter 使用单条 user 消息（与后端整段 prompt 风格一致；若需多轮格式可设 SIMULATE_STRUCTURED_MESSAGES=1）"
        );
      }
    }

    const body = {
      model: llm.model,
      messages,
      max_tokens: SIMULATE_MAX_TOKENS,
      temperature: attempt === 0 ? 0.7 : 0.85,
    };
    if (useMiddleOut) {
      body.transforms = ["middle-out"];
    }

    const routing = getOpenRouterProviderRouting();
    if (routing.ignore?.length) {
      body.provider = routing;
      if (attempt === 0) {
        console.log("[模拟脚本] OpenRouter provider.ignore =", routing.ignore.join(", "));
      }
    }

    // 与后端一致：OpenRouter 流式，避免部分路由非流式返回 message.content=null
    const res = await fetch(llm.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`大模型请求失败: ${res.status} ${text}`);
    }
    const { text: content, rawSsePreview } = await accumulateOpenRouterStreamText(res);
    if (content) return content;
    lastFailedPayload = {
      _note: "OpenRouter 流式解析后仍为空",
      stream: true,
      rawSsePreview: rawSsePreview || "(无原始字节)",
      contentType: res.headers.get("content-type"),
    };
    console.warn(`[模拟脚本] OpenRouter 流式未解析到正文 (attempt ${attempt + 1})。`);
    await sleep(400);
  }

  let lastSnippet = "";
  try {
    lastSnippet = JSON.stringify(lastFailedPayload ?? {}).slice(0, 1500);
  } catch {
    lastSnippet = String(lastFailedPayload);
  }
  throw new Error(
    `大模型多次重试后仍无可用正文。若 delta.content 恒为 ""，多为上游/路由问题；已默认用单条 user 提示（与后端一致）。可换 SIMULATE_LLM_MODEL 或设 SIMULATE_STRUCTURED_MESSAGES=1 对比。详情：${lastSnippet}`
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("[模拟脚本] API 地址:", API_BASE);
  console.log("[模拟脚本] 对话轮数:", TURNS);
  const llm = getLLMConfig();
  if (!llm) {
    console.error("[模拟脚本] 请设置 OPENROUTER_API_KEY 以生成模拟用户消息。");
    process.exit(1);
  }

  const { token, userId } = await registerOrLogin();
  const priorHistory = await fetchAllMessages(token, userId);

  /** 本次脚本运行内新产生的 user/assistant 轮次（会追加到 prior 之后参与下一次生成） */
  const sessionHistory = [];

  /** 有历史则第一句也由模型根据纯历史生成；无历史则用 FIRST_MESSAGE */
  let nextUserMessage;
  if (priorHistory.length > 0) {
    console.log("[模拟脚本] 根据已有历史生成本轮第一句用户话…");
    nextUserMessage = await generateNextUserMessage(llm, priorHistory, { opening: true });
    await sleep(300);
  } else {
    nextUserMessage = FIRST_MESSAGE;
    console.log("[模拟脚本] 无历史消息，使用 FIRST_MESSAGE 作为第一句。");
  }

  for (let i = 0; i < TURNS; i++) {
    console.log("\n--- 第", i + 1, "轮 ---");
    console.log("用户:", nextUserMessage);
    sessionHistory.push({ role: "user", content: nextUserMessage });

    const assistantReply = await sendChat(token, userId, nextUserMessage);
    console.log("助手:", assistantReply);
    sessionHistory.push({ role: "assistant", content: assistantReply });

    if (i < TURNS - 1) {
      const fullForLLM = [...priorHistory, ...sessionHistory];
      nextUserMessage = await generateNextUserMessage(llm, fullForLLM, { opening: false });
      await sleep(300);
    }
  }
  console.log("\n[模拟脚本] 对话结束。");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
