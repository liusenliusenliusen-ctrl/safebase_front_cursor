export async function getEmbedding(
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
