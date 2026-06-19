import { apiFetch, getToken } from "@/api/client";

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
}

export interface StreamChatOptions {
  userMessageId: string;
}

export async function streamChatCompletion(
  messages: { role: string; content: string }[],
  options: StreamChatOptions,
  callbacks: StreamCallbacks
): Promise<() => void> {
  const token = getToken();
  if (!token) {
    callbacks.onError(new Error("未登录"));
    return () => {};
  }

  const res = await apiFetch("/api/chat/stream", {
    method: "POST",
    body: JSON.stringify({
      messages,
      user_message_id: Number(options.userMessageId),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    callbacks.onError(new Error(res.statusText + (errBody ? `: ${errBody}` : "")));
    return () => {};
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError(new Error("No response body"));
    return () => {};
  }

  const decoder = new TextDecoder();
  let cancelled = false;
  let ended = false;
  let buffer = "";

  const endOnce = () => {
    if (ended || cancelled) return;
    ended = true;
    callbacks.onEnd();
  };

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
            endOnce();
            return;
          }
        }
      }
      endOnce();
    } catch (e) {
      if (!cancelled && !ended) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  })();

  return () => {
    cancelled = true;
    reader.cancel();
  };
}
