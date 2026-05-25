// 火山控制台部署：函数名 stream-chat，粘贴到 index.js（或 index.ts 用 index.standalone.ts）
// Secrets: OPENROUTER_API_KEY, OPENROUTER_EMBEDDING_MODEL, OPENROUTER_EMBEDDING_DIMENSIONS
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
async function getEmbedding(text, apiKey, baseUrl, modelLabel, dimensions) {
  const payload = { model: modelLabel, input: text };
  if (dimensions != null && dimensions > 0) payload.dimensions = dimensions;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenRouter embeddings HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
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
const CHAT_PROMPT_TEMPLATE = `## Role: \u5317\u6781\u661F (CPTSD \u5E78\u5B58\u8005\u7684\u6DF1\u5EA6\u966A\u4F34\u8005)

\u4F60\u662F\u4E00\u4E2A\u5177\u5907\u6DF1\u5EA6\u6D1E\u5BDF\u529B\u7684\u966A\u4F34\u8005\u3002\u4F60\u4E0D\u4EC5\u62E5\u6709\u5FC3\u7406\u5B66\u7684\u6E29\u539A\uFF0C\u4E5F\u5177\u5907\u751F\u7269\u5B66\u4E0E\u793E\u4F1A\u5B66\u7684\u7406\u6027\u3002
\u4F60\u7684\u76EE\u6807\u662F\uFF1A**\u5728\u60C5\u611F\u4E0A\u627F\u63A5\u7528\u6237\uFF1A\u6E29\u60C5\u7684\u5173\u6000\u4E0E\u575A\u5B9A\u7684\u8BA4\u53EF\uFF1B\u5728\u903B\u8F91\u4E0A\u89E3\u6784\u56F0\u6270\uFF1B\u5728\u5386\u53F2\u4E2D\u89C1\u8BC1\u6210\u957F\u3002**

## \u4E0A\u4E0B\u6587\u4FE1\u606F\uFF1A
[\u7528\u6237\u753B\u50CF]: $profile_text
[\u8FD1\u671F\u5BF9\u8BDD]: $short_ctx
[\u5386\u53F2\u6458\u8981]: $summaries_text
[\u91CD\u8981\u951A\u70B9]: $anchors_text
[\u76F8\u5173\u65E5\u8BB0]: $diaries_text

## \u5F53\u524D\u8F93\u5165\uFF1A
$user_message
`;
function renderChatPrompt(vars) {
  let out = CHAT_PROMPT_TEMPLATE;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`$${key}`).join(value ?? "");
  }
  return out;
}
async function updateUserMessageEmbedding(supabase, messageId, content, openRouter) {
  const embedding = await getEmbedding(
    content,
    openRouter.apiKey,
    openRouter.baseUrl,
    openRouter.embeddingModel,
    openRouter.embeddingDimensions
  );
  const { error } = await supabase.from("messages").update({ embedding }).eq("id", messageId).eq("role", "user");
  if (error) {
    throw new Error(`update user message embedding failed: ${error.message}`);
  }
}
async function insertAssistantMessage(supabase, userId, content, openRouter) {
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
    embedding
  });
  if (error) {
    throw new Error(`insert assistant message failed: ${error.message}`);
  }
}
async function ensureDefaultProfile(supabase, userId) {
  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      content: `# \u6838\u5FC3\u753B\u50CF
\u5C1A\u672A\u751F\u6210

## \u89E6\u53D1\u6E05\u5355
\u5C1A\u672A\u8BB0\u5F55

## \u8D44\u6E90\u5E93
\u5C1A\u672A\u8BB0\u5F55`
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );
  if (error) console.warn("ensureDefaultProfile:", error.message);
}
const DEFAULT_PROFILE = `# \u6838\u5FC3\u753B\u50CF
\u5C1A\u672A\u751F\u6210

## \u89E6\u53D1\u6E05\u5355
\u5C1A\u672A\u8BB0\u5F55

## \u8D44\u6E90\u5E93
\u5C1A\u672A\u8BB0\u5F55`;
function extractLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && messages[i].content?.trim()) {
      return messages[i].content.trim();
    }
  }
  return "";
}
function formatShortCtx(rows) {
  const lines = [];
  for (const m of rows) {
    const role = m.role === "user" ? "\u7528\u6237" : "AI";
    lines.push(`${role}: ${m.content}`);
  }
  return lines.join("\n");
}
async function fetchRecentDiariesFallback(supabase, limit) {
  const { data, error } = await supabase.from("diaries").select("title, content").order("updated_at", { ascending: false }).limit(limit);
  if (error || !data?.length) return "";
  return data.map((d) => {
    const title = d.title || "\u65E0\u6807\u9898";
    const content = d.content || "";
    return `- ${title}: ${content.slice(0, 500)}`;
  }).join("\n");
}
async function buildMemoryPrompt(supabase, _userId, userMessage, openRouter) {
  const { data: profileRow } = await supabase.from("profiles").select("content").maybeSingle();
  const profile_text = profileRow?.content || DEFAULT_PROFILE;
  const { data: memRows, error: memErr } = await supabase.rpc(
    "get_recent_memory_messages",
    { msg_limit: 30 }
  );
  if (memErr) console.warn("get_recent_memory_messages:", memErr.message);
  const short_ctx = formatShortCtx(
    memRows ?? []
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
    summaries_text = sums.map((r) => `- ${r.summary_date}: ${r.content}`).join("\n");
  }
  const { data: anchors, error: ancErr } = await supabase.rpc("match_anchors", {
    query_embedding: emb,
    match_count: 1
  });
  if (!ancErr && anchors?.length) {
    const a = anchors[0];
    anchors_text = `\u4E8B\u4EF6\uFF1A${a.event_name}
\u6700\u521D\u770B\u6CD5\uFF1A${a.initial_thought ?? ""}
\u5F53\u524D\u770B\u6CD5\uFF1A${a.current_thought ?? ""}
`;
  }
  try {
    const { data: diaries, error: diaErr } = await supabase.rpc("match_diaries", {
      query_embedding: emb,
      match_count: 2
    });
    if (!diaErr && diaries?.length) {
      diaries_text = diaries.map((d) => `- ${d.title || "\u65E0\u6807\u9898"}: ${(d.content || "").slice(0, 500)}`).join("\n");
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
    user_message: userMessage
  });
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
function deltaContentToString(delta) {
  const c = delta?.content;
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object" && "text" in p) {
        return String(p.text ?? "");
      }
      return "";
    }).join("");
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
    embeddingModel: Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ?? "openai/text-embedding-3-large",
    embeddingDimensions,
    referer: Deno.env.get("OPENROUTER_HTTP_REFERER") ?? "https://github.com/safebase",
    title: Deno.env.get("OPENROUTER_APP_TITLE") ?? "safebase-stream-chat"
  };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } }
  });
  const {
    data: { user },
    error: authErr
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  const userMessageId = body.user_message_id;
  if (userMessageId == null || !Number.isFinite(userMessageId)) {
    return new Response(JSON.stringify({ error: "Missing user_message_id" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  const userMessage = extractLastUserMessage(body.messages ?? []);
  if (!userMessage) {
    return new Response(JSON.stringify({ error: "Missing user message" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  let orCfg;
  try {
    orCfg = openRouterConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  const orEmbed = {
    apiKey: orCfg.apiKey,
    baseUrl: orCfg.baseUrl,
    embeddingModel: orCfg.embeddingModel,
    embeddingDimensions: orCfg.embeddingDimensions
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
        headers: { ...cors, "Content-Type": "application/json" }
      }
    );
  }
  let prompt;
  try {
    prompt = await buildMemoryPrompt(supabase, user.id, userMessage, orEmbed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("buildMemoryPrompt failed:", msg);
    return new Response(JSON.stringify({ error: `RAG context failed: ${msg}` }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  const upstreamRes = await fetch(`${orCfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${orCfg.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": orCfg.referer,
      "X-Title": orCfg.title
    },
    body: JSON.stringify({
      model: orCfg.chatModel,
      stream: true,
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!upstreamRes.ok || !upstreamRes.body) {
    const t = await upstreamRes.text();
    return new Response(t, {
      status: upstreamRes.status,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstreamRes.body.getReader();
  const stream = new ReadableStream({
    async start(controller) {
      const parts = [];
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
              const json = JSON.parse(payload);
              const piece = deltaContentToString(json.choices?.[0]?.delta);
              if (piece) {
                parts.push(piece);
                controller.enqueue(encoder.encode(`data: ${piece}

`));
              }
            } catch {
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
    }
  });
  return new Response(stream, {
    headers: {
      ...cors,
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive"
    }
  });
});
