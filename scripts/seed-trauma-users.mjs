/**
 * 创伤人设用户：清空旧数据 → 按上下文与模型回复动态生成 10 轮对话 → 写 2 篇细节日记。
 * 用法: node scripts/seed-trauma-users.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const PASSWORD = "lb6325515";
const ROUNDS = 10;
const DIARIES_PER_USER = 2;
const CHAT_ONLY = process.argv.includes("--chat-only");

const CHAT_STYLE_RULES = `【文字聊天格式——必须严格遵守】
- 场景：用户在手机/电脑上打字，不是语音、不是剧本、不是小说
- 禁止：任何括号内的动作/表情/语气描写。例：（停顿了一会）（眼眶有点湿）（小声）（低头玩手指）
- 禁止：星号包裹的动作 *叹气*、镜头式旁白、对白舞台提示
- 禁止：描写自己正在做什么动作，如"对着镜子微笑""把脸埋进毛毯"——想说感受就直接说感受
- 允许：口语化打字，如 嗯、其实、说实话、有点、好吧、……
- 允许：直接写想法、感受、回忆，像给信任的人发消息
- 长度：每条约 2-4 句，30-120 字，平实自然，不要文艺腔`;

const USERS = [
  {
    username: "lin_morning",
    label: "林晓晨 · 职场警觉型",
    persona: `28岁女性，互联网公司运营。童年父母情绪起伏大，常要求她"懂事、别添乱"；学会在外面微笑、回家缩起来。
创伤相关模式：被点名/被批评时冻结（脑子空白、说不出话）、事后反复回想自己是否出错、浅眠易惊醒、回避同事聚餐、对别人的善意也本能警惕。
打字习惯：句子不长，偶尔用省略号，会说具体小事，不抒情过度，不用心理学术语。`,
    openingHint:
      "今天开会时被领导突然点名，你当场僵住了，散会后心里还乱着，想跟疗愈伙伴说说这件事。",
  },
  {
    username: "chen_night",
    label: "陈夜雨 · 讨好与关系型",
    persona: `35岁，自由职业插画师。成长中母亲以"为你好"控制，父亲沉默；长期讨好、害怕冲突，把关系破裂当成灾难。
创伤相关模式：fawn（讨好）反应、难拒绝、别人不高兴就先自责、偶尔情绪爆发后强烈羞耻、正在学着表达真实需要。
打字习惯：语气软，常用"可能""是不是我想多了"，会道歉但也在试着说真话，像认真打字回复消息。`,
    openingHint:
      "昨晚和伴侣说话时，对方语气重了一点，你立刻开始道歉，事后觉得很累，想聊聊这种停不下来的讨好。",
  },
  {
    username: "su_river",
    label: "苏清河 · 解离与躯体化",
    persona: `22岁大学生，心理学专业。幼年反复住院与照顾者不稳定，常感到不真实、像在旁观自己；检查无器质性问题但躯体症状反复。
创伤相关模式：解离、感官过载（噪音/拥挤）、噩梦、会用接地技巧自救，不太愿被同学当"怪人"。
打字习惯：观察细，会写身体感受，但用正常聊天口吻，不写成散文，偶尔提一句专业词马上回到自己的感觉。`,
    openingHint:
      "今天在地铁早高峰突然喘不上气、手脚发麻，像不是自己的人在走路，缓了几分钟才回过神，想说说刚才那几分钟。",
  },
];

function loadOpenRouterConfig() {
  const envPath = resolve(__dirname, "../../safebase_backend_cursor/.env");
  const vars = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const apiKey = process.env.OPENROUTER_API_KEY ?? vars.OPENROUTER_API_KEY ?? "";
  const baseUrl = (
    process.env.OPENROUTER_BASE_URL ??
    vars.OPENROUTER_BASE_URL ??
    "https://openrouter.ai/api/v1"
  ).replace(/\/$/, "");
  const model =
    process.env.OPENROUTER_CHAT_MODEL ??
    vars.OPENROUTER_CHAT_MODEL ??
    "deepseek/deepseek-chat";
  if (!apiKey) throw new Error("缺少 OPENROUTER_API_KEY（backend .env 或环境变量）");
  return { apiKey, baseUrl, model };
}

const OR = loadOpenRouterConfig();

async function llmChat(system, user, { temperature = 0.85, maxTokens = 600 } = {}) {
  const res = await fetch(`${OR.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OR.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OR.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${text}`);
  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("OpenRouter 返回空内容");
  return content.replace(/^["「『]|["」』]$/g, "").trim();
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }
  return data;
}

async function login(username) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: { username, password: PASSWORD },
  });
  return data.token;
}

function clearMessagesOnly(usernames) {
  const list = usernames.map((u) => `'${u}'`).join(", ");
  const sub = `SELECT id FROM public.users WHERE username IN (${list})`;
  const stmts = [
    `DELETE FROM public.messages WHERE user_id IN (${sub})`,
    `DELETE FROM public.summaries WHERE user_id IN (${sub})`,
    `DELETE FROM public.anchors WHERE user_id IN (${sub})`,
  ];
  for (const sql of stmts) {
    execSync(
      `docker exec trauma-heal-postgres psql -U postgres -d trauma_heal -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
      { stdio: "pipe" }
    );
  }
}

function clearUserData(usernames) {
  const list = usernames.map((u) => `'${u}'`).join(", ");
  const sub = `SELECT id FROM public.users WHERE username IN (${list})`;
  const stmts = [
    `DELETE FROM public.messages WHERE user_id IN (${sub})`,
    `DELETE FROM public.diaries WHERE user_id IN (${sub})`,
    `DELETE FROM public.summaries WHERE user_id IN (${sub})`,
    `DELETE FROM public.anchors WHERE user_id IN (${sub})`,
  ];
  for (const sql of stmts) {
    execSync(
      `docker exec trauma-heal-postgres psql -U postgres -d trauma_heal -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`,
      { stdio: "pipe" }
    );
  }
}

function formatHistory(history) {
  if (!history.length) return "（尚无对话）";
  return history
    .map((m) => `${m.role === "user" ? "我" : "疗愈伙伴"}：${m.content}`)
    .join("\n\n");
}

function sanitizeUserMessage(text) {
  return text
    .trim()
    .replace(/^["「『]|["」』]$/g, "")
    .replace(/（[^）]{0,40}）/g, "")
    .replace(/\([^)]{0,40}\)/g, "")
    .replace(/\*[^*]{1,40}\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function generateUserMessage(user, round, history, lastAssistant) {
  const system = `你在扮演一位 有创伤经历的来访者，在 Safebase App 的输入框里打字发消息。
${CHAT_STYLE_RULES}

只输出下一条要发送的文字，不要引号、不要前缀、不要解释。`;

  const examples = `【好的打字示例】
"今天开会被领导点名，我脑子一下子空了，散会后才缓过来，一直在想是不是我说错什么了。"
"你说的那个办法我试了，好像有用，但我还是会忍不住担心明天。"
"嗯，听你这么说感觉好一点。就是……我还是不太敢答应同事的聚餐。"

【错误示例——不要这样写】
"（停顿了一会）其实……"
"（眼眶有点湿）谢谢你"
"对着镜子微笑，这个听起来有点难"`;

  if (round === 1) {
    const raw = await llmChat(
      system,
      `${examples}

【人设】
${user.persona}

【开场情境】
${user.openingHint}

第 1 轮：写你打开 App 发的第一条消息。`,
      { temperature: 0.72 }
    );
    return sanitizeUserMessage(raw);
  }

  const raw = await llmChat(
    system,
    `${examples}

【人设】
${user.persona}

【已有对话】
${formatHistory(history)}

【疗愈伙伴刚回复】
${lastAssistant}

第 ${round}/${ROUNDS} 轮：根据对方刚才的回复，打下一条消息。
- 要回应对方内容，可追问、认同、补充或表达犹豫
- 带一点新信息，不要重复已说过的话
- 必须是打字聊天，不是剧本`,
    { temperature: 0.72 }
  );
  return sanitizeUserMessage(raw);
}

async function generateDiary(user, index, history) {
  const angles = [
    "聚焦今天对话里触动最深的一个具体场景，用更多感官细节（光线、声音、身体感觉）展开。",
    "写对话之后的余韵：夜里独处时的回想、自我对话、或一个小小的自我照顾举动。",
  ];
  const raw = await llmChat(
    `你是 有创伤经历的来访者在写私人日记。第一人称，中文，真诚细腻，允许矛盾与脆弱。输出严格 JSON：{"title":"...","content":"..."}，不要 markdown 代码块。`,
    `【人设】
${user.persona}

【今天与疗愈伙伴的对话摘要】
${formatHistory(history)}

请写第 ${index + 1} 篇日记。${angles[index]}
要求：
- title：简短有画面感，10 字以内为佳
- content：400-700 字，分段，含具体时间/地点/动作/身体感受/内心独白，比聊天更深入`,
    { temperature: 0.9, maxTokens: 1200 }
  );

  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : raw);
  } catch {
    const lines = raw.split("\n").filter(Boolean);
    return {
      title: lines[0]?.replace(/^标题[：:]\s*/, "") || `日记 ${index + 1}`,
      content: lines.slice(1).join("\n\n") || raw,
    };
  }
}

async function streamChat(token, userMessageId, messages) {
  const res = await fetch(`${API}/api/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages, user_message_id: userMessageId }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`chat stream ${res.status}: ${t}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) reply += line.slice(6);
      if (line.startsWith("event: end")) return reply.trim();
    }
  }
  return reply.trim();
}

async function runUser(user, { chatOnly }) {
  console.log(`\n=== ${user.label} (${user.username}) ===`);
  const token = await login(user.username);
  const history = [];

  for (let round = 1; round <= ROUNDS; round++) {
    const lastAssistant =
      history.filter((m) => m.role === "assistant").at(-1)?.content ?? "";
    process.stdout.write(`  生成用户消息 ${round}/${ROUNDS} … `);
    const userText = await generateUserMessage(user, round, history, lastAssistant);
    if (userText.length < 8) {
      throw new Error(`第 ${round} 轮用户消息过短或无效: "${userText}"`);
    }
    console.log(`「${userText.slice(0, 36)}${userText.length > 36 ? "…" : ""}」`);

    const msg = await api("/api/messages", {
      method: "POST",
      token,
      body: { role: "user", content: userText },
    });
    history.push({ role: "user", content: userText });

    process.stdout.write(`  等待疗愈伙伴回复 … `);
    const reply = await streamChat(
      token,
      Number(msg.id),
      history.map((m) => ({ role: m.role, content: m.content }))
    );
    history.push({ role: "assistant", content: reply });
    console.log(`✓ (${reply.length} 字)`);
  }

  if (!chatOnly) {
    for (let i = 0; i < DIARIES_PER_USER; i++) {
    process.stdout.write(`  生成日记 ${i + 1}/${DIARIES_PER_USER} … `);
    const diary = await generateDiary(user, i, history);
    await api("/api/diaries", {
      method: "POST",
      token,
      body: { title: diary.title, content: diary.content },
    });
    console.log(`✓ 《${diary.title}》（${diary.content.length} 字）`);
    }
  }
}

async function main() {
  const health = await api("/api/health");
  if (!health?.ok) throw new Error("后端未就绪");

  const names = USERS.map((u) => u.username);
  if (CHAT_ONLY) {
    console.log(`仅清空对话: ${names.join(", ")}`);
    clearMessagesOnly(names);
    console.log("已删除消息及相关记忆数据（日记保留）");
  } else {
    console.log(`清空旧数据: ${names.join(", ")}`);
    clearUserData(names);
    console.log("已删除消息、日记及相关记忆数据");
  }

  for (const user of USERS) {
    await runUser(user, { chatOnly: CHAT_ONLY });
  }

  console.log("\n========== 完成 ==========");
  console.log("用户名（密码均为 lb6325515）：");
  for (const u of USERS) console.log(`  - ${u.username}  (${u.label})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
