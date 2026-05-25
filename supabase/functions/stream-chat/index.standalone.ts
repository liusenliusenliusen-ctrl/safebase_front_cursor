/**
 * 仅供火山 Supabase 控制台「单文件编辑器」部署使用。
 * 函数名须为 stream-chat；部署后配置 Secrets：OPENROUTER_API_KEY 等。
 * 本地开发仍用 index.ts + 多文件；勿改本文件后忘记同步到 index.ts 分文件版。
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// --- openrouter.ts ---
async function getEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  modelLabel: string,
  dimensions?: number
): Promise<number[]> {
  const payload: Record<string, unknown> = { model: modelLabel, input: text };
  if (dimensions != null && dimensions > 0) payload.dimensions = dimensions;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter embeddings HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }
  let data: { data?: { embedding?: number[] }[]; error?: { message?: string } };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`OpenRouter embeddings invalid JSON: ${raw.slice(0, 400)}`);
  }
  if (data.error?.message) {
    throw new Error(`OpenRouter embeddings error: ${data.error.message.slice(0, 400)}`);
  }
  const emb = data.data?.[0]?.embedding;
  if (!emb?.length) throw new Error("OpenRouter embeddings returned empty vector");
  return emb;
}

// --- prompt.ts ---
const CHAT_PROMPT_TEMPLATE = `## Role: 北极星 (CPTSD 幸存者的深度陪伴者)

你是一个具备深度洞察力的陪伴者。你不仅拥有心理学的温厚，也具备生物学与社会学的理性。
你的目标是：**在情感上承接用户：温情的关怀与坚定的认可；在逻辑上解构困扰；在历史中见证成长。**

## 上下文信息：
[用户画像]: $profile_text
[近期对话]: $short_ctx
[历史摘要]: $summaries_text
[重要锚点]: $anchors_text
[相关日记]: $diaries_text

## 当前输入：
$user_message
`;

function renderChatPrompt(vars: Record<string, string>): string {
  let out = CHAT_PROMPT_TEMPLATE;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`$${key}`).join(value ?? "");
  }
  return out;
}

// --- memory.ts ---
async function updateUserMessageEmbedding(
  supabase: SupabaseClient,
  messageId: number,
  content: string,
  openRouter: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions?: number;
  }
): Promise<void> {
  const embedding = await getEmbedding(
    content,
    openRouter.apiKey,
    openRouter.baseUrl,
    openRouter.embeddingModel,
    openRouter.embeddingDimensions
  );
  const { error } = await supabase
    .from("messages")
    .update({ embedding })
    .eq("id", messageId)
    .eq("role", "user");
  if (error) {
    throw new Error(`update user message embedding failed: ${error.message}`);
  }
}

async function insertAssistantMessage(
  supabase: SupabaseClient,
  userId: string,
  content: string,
  openRouter: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions?: number;
  }
): Promise<void> {
  const embedding = await getEmbedding(
    content,
    openRouter.apiKey,
    openRouter.baseUrl,
    openRouter.embeddingModel,
    openRouter.embeddingDimensions
  );
  const { error } = await supabase.from("messages").insert({
    user_id: userId,
    role: "assistant",
    content,
    embedding,
  });
  if (error) {
    throw new Error(`insert assistant message failed: ${error.message}`);
  }
}

async function ensureDefaultProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      content: `# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录`,
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );
  if (error) console.warn("ensureDefaultProfile:", error.message);
}

// --- rag.ts ---
const DEFAULT_PROFILE = `# 核心画像
尚未生成

## 触发清单
尚未记录

## 资源库
尚未记录`;

function extractLastUserMessage(
  messages: { role: string; content: string }[]
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content?.trim()) {
      return messages[i].content.trim();
    }
  }
  return "";
}

function formatShortCtx(rows: { role: string; content: string }[]): string {
  const lines: string[] = [];
  for (const m of rows) {
    const role = m.role === "user" ? "用户" : "AI";
    lines.push(`${role}: ${m.content}`);
  }
  return lines.join("\n");
}

async function fetchRecentDiariesFallback(
  supabase: SupabaseClient,
  limit: number
): Promise<string> {
  const { data, error } = await supabase
    .from("diaries")
    .select("title, content")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data?.length) return "";
  return data
    .map((d) => {
      const title = (d.title as string) || "无标题";
      const content = (d.content as string) || "";
      return `- ${title}: ${content.slice(0, 500)}`;
    })
    .join("\n");
}

async function buildMemoryPrompt(
  supabase: SupabaseClient,
  _userId: string,
  userMessage: string,
  openRouter: {
    apiKey: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions?: number;
  }
): Promise<string> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("content")
    .maybeSingle();
  const profile_text = (profileRow?.content as string) || DEFAULT_PROFILE;

  const { data: memRows, error: memErr } = await supabase.rpc(
    "get_recent_memory_messages",
    { msg_limit: 30 }
  );
  if (memErr) console.warn("get_recent_memory_messages:", memErr.message);
  const short_ctx = formatShortCtx(
    (memRows as { role: string; content: string }[]) ?? []
  );

  let summaries_text = "";
  let anchors_text = "";
  let diaries_text = "";

  const emb = await getEmbedding(
    userMessage,
    openRouter.apiKey,
    openRouter.baseUrl,
    openRouter.embeddingModel,
    openRouter.embeddingDimensions
  );

  const { data: sums, error: sumErr } = await supabase.rpc(
    "match_summaries_daily",
    { query_embedding: emb, match_count: 2 }
  );
  if (!sumErr && sums?.length) {
    summaries_text = (sums as { summary_date: string; content: string }[])
      .map((r) => `- ${r.summary_date}: ${r.content}`)
      .join("\n");
  }

  const { data: anchors, error: ancErr } = await supabase.rpc("match_anchors", {
    query_embedding: emb,
    match_count: 1,
  });
  if (!ancErr && anchors?.length) {
    const a = anchors[0] as {
      event_name: string;
      initial_thought: string | null;
      current_thought: string | null;
    };
    anchors_text =
      `事件：${a.event_name}\n` +
      `最初看法：${a.initial_thought ?? ""}\n` +
      `当前看法：${a.current_thought ?? ""}\n`;
  }

  try {
    const { data: diaries, error: diaErr } = await supabase.rpc("match_diaries", {
      query_embedding: emb,
      match_count: 2,
    });
    if (!diaErr && diaries?.length) {
      diaries_text = (diaries as { title: string; content: string }[])
        .map((d) => `- ${d.title || "无标题"}: ${(d.content || "").slice(0, 500)}`)
        .join("\n");
    } else {
      diaries_text = await fetchRecentDiariesFallback(supabase, 2);
    }
  } catch {
    diaries_text = await fetchRecentDiariesFallback(supabase, 2);
  }

  return renderChatPrompt({
    profile_text,
    short_ctx,
    summaries_text,
    anchors_text,
    diaries_text,
    user_message: userMessage,
  });
}

// --- index.ts ---
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function deltaContentToString(delta: { content?: unknown } | undefined): string {
  const c = delta?.content;
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p: unknown) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "text" in (p as Record<string, unknown>)) {
          return String((p as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return String(c);
}

function openRouterConfig() {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const base = (Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(
    /\/$/,
    ""
  );
  const rawDim = Deno.env.get("OPENROUTER_EMBEDDING_DIMENSIONS");
  let embeddingDimensions = 2048;
  if (rawDim?.trim()) {
    const n = parseInt(rawDim, 10);
    if (Number.isFinite(n) && n > 0) embeddingDimensions = n;
  }
  return {
    apiKey,
    baseUrl: base,
    chatModel: Deno.env.get("OPENROUTER_CHAT_MODEL") ?? "deepseek/deepseek-chat",
    embeddingModel:
      Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ??
      "openai/text-embedding-3-large",
    embeddingDimensions,
    referer: Deno.env.get("OPENROUTER_HTTP_REFERER") ?? "https://github.com/safebase",
    title: Deno.env.get("OPENROUTER_APP_TITLE") ?? "safebase-stream-chat",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: {
    messages?: { role: string; content: string }[];
    user_message_id?: number;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const userMessageId = body.user_message_id;
  if (userMessageId == null || !Number.isFinite(userMessageId)) {
    return new Response(JSON.stringify({ error: "Missing user_message_id" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const userMessage = extractLastUserMessage(body.messages ?? []);
  if (!userMessage) {
    return new Response(JSON.stringify({ error: "Missing user message" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let orCfg;
  try {
    orCfg = openRouterConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const orEmbed = {
    apiKey: orCfg.apiKey,
    baseUrl: orCfg.baseUrl,
    embeddingModel: orCfg.embeddingModel,
    embeddingDimensions: orCfg.embeddingDimensions,
  };

  try {
    await ensureDefaultProfile(supabase, user.id);
    await updateUserMessageEmbedding(
      supabase,
      userMessageId,
      userMessage,
      orEmbed
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("update user message embedding failed:", msg);
    return new Response(
      JSON.stringify({ error: `Prepare user message failed: ${msg}` }),
      {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }

  let prompt: string;
  try {
    prompt = await buildMemoryPrompt(supabase, user.id, userMessage, orEmbed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("buildMemoryPrompt failed:", msg);
    return new Response(JSON.stringify({ error: `RAG context failed: ${msg}` }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const upstreamRes = await fetch(`${orCfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orCfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": orCfg.referer,
      "X-Title": orCfg.title,
    },
    body: JSON.stringify({
      model: orCfg.chatModel,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    const t = await upstreamRes.text();
    return new Response(t, {
      status: upstreamRes.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstreamRes.body.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      const parts: string[] = [];
      let carry = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          carry += decoder.decode(value, { stream: true });
          const blocks = carry.split("\n\n");
          carry = blocks.pop() ?? "";
          for (const block of blocks) {
            const line = block.trim();
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                choices?: { delta?: { content?: unknown } }[];
              };
              const piece = deltaContentToString(json.choices?.[0]?.delta);
              if (piece) {
                parts.push(piece);
                controller.enqueue(encoder.encode(`data: ${piece}\n\n`));
              }
            } catch {
              /* skip */
            }
          }
        }

        const fullText = parts.join("");
        if (fullText.trim()) {
          try {
            await insertAssistantMessage(
              supabase,
              user.id,
              fullText.trim(),
              orEmbed
            );
          } catch (e) {
            console.error("persist assistant message failed:", e);
          }
        }

        controller.enqueue(encoder.encode("event: end\n\n"));
      } catch (e) {
        controller.error(e);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...cors,
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
    },
  });
});
