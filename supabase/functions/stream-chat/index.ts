import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildMemoryPrompt,
  extractLastUserMessage,
} from "./rag.ts";
import {
  ensureDefaultProfile,
  insertAssistantMessage,
  updateUserMessageEmbedding,
} from "./memory.ts";

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
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
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
    // 用户消息已由前端写入 messages；此处仅补 embedding，再拼 RAG
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
