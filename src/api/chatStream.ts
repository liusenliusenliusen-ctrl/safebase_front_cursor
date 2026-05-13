import { supabase } from "@/lib/supabase";

const functionsBase = () => {
  const u = import.meta.env.VITE_SUPABASE_URL ?? "";
  return `${u.replace(/\/$/, "")}/functions/v1`;
};

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
}

/**
 * 调用 Supabase Edge Function，将 OpenAI 流式结果转为与旧后端一致的 `data:` / `event: end` SSE。
 */
export async function streamChatCompletion(
  messages: { role: string; content: string }[],
  callbacks: StreamCallbacks
): Promise<() => void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    callbacks.onError(new Error("未登录"));
    return () => {};
  }

  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  const res = await fetch(`${functionsBase()}/stream-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: anon,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    callbacks.onError(
      new Error(res.statusText + (errBody ? `: ${errBody}` : ""))
    );
    return () => {};
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("No response body"));
    return () => {};
  }

  const decoder = new TextDecoder();
  let cancelled = false;
  let buffer = "";

  (async () => {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (cancelled) break;
          if (line.startsWith("data: ")) {
            const text = line.slice(6);
            if (text) callbacks.onChunk(text);
          }
          if (line.startsWith("event: end")) {
            callbacks.onEnd();
            return;
          }
        }
      }
      if (!cancelled) callbacks.onEnd();
    } catch (e) {
      if (!cancelled)
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return () => {
    cancelled = true;
    reader.cancel();
  };
}
