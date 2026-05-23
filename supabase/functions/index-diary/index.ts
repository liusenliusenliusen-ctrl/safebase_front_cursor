import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function getEmbedding(
  text: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  dimensions?: number
): Promise<number[]> {
  const payload: Record<string, unknown> = { model, input: text };
  if (dimensions != null && dimensions > 0) {
    payload.dimensions = dimensions;
  }
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
    throw new Error(`embeddings HTTP ${res.status}: ${raw.slice(0, 300)}`);
  }
  let data: { data?: { embedding?: number[] }[]; error?: { message?: string } };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error(`embeddings invalid JSON: ${raw.slice(0, 300)}`);
  }
  if (data.error?.message) {
    throw new Error(`embeddings error: ${data.error.message.slice(0, 300)}`);
  }
  const emb = data.data?.[0]?.embedding;
  if (!emb?.length) throw new Error("empty embedding");
  return emb;
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

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

  let body: { diary_id?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const diaryId = body.diary_id;
  if (diaryId == null || !Number.isFinite(Number(diaryId))) {
    return new Response(JSON.stringify({ error: "diary_id required" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data: row, error: selErr } = await supabase
    .from("diaries")
    .select("id, user_id, title, content")
    .eq("id", diaryId)
    .maybeSingle();

  if (selErr || !row) {
    return new Response(JSON.stringify({ error: "Diary not found" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  if (row.user_id !== user.id) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not set" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const base = Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
  const embeddingModel =
    Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ??
    "openai/text-embedding-3-large";
  const dimRaw = Deno.env.get("OPENROUTER_EMBEDDING_DIMENSIONS");
  const dimensions = dimRaw ? parseInt(dimRaw, 10) : 2048;

  const text = `${row.title ?? ""}\n${row.content ?? ""}`.trim() || " ";
  try {
    const embedding = await getEmbedding(
      text,
      apiKey,
      base,
      embeddingModel,
      dimensions
    );
    const { error: updErr } = await supabase
      .from("diaries")
      .update({ embedding })
      .eq("id", diaryId)
      .eq("user_id", user.id);

    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, diary_id: diaryId }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
