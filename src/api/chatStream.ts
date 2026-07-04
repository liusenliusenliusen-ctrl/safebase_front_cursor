import { apiFetch, getToken } from "@/api/client";

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
}

export interface StreamChatOptions {
  userMessageId: string;
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

/**
 * 启动流式对话。立即返回 cancel；可在 fetch 完成前 abort（例如用户点「停止」）。
 */
export function streamChatCompletion(
  messages: { role: string; content: string }[],
  options: StreamChatOptions,
  callbacks: StreamCallbacks
): () => void {
  const token = getToken();
  if (!token) {
    callbacks.onError(new Error("未登录"));
    return () => {};
  }

  const controller = new AbortController();
  let cancelled = false;
  let ended = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const endOnce = () => {
    if (ended || cancelled) return;
    ended = true;
    callbacks.onEnd();
  };

  const cancel = () => {
    cancelled = true;
    controller.abort();
    void reader?.cancel().catch(() => {});
  };

  void (async () => {
    try {
      const res = await apiFetch("/api/chat/stream", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          messages,
          user_message_id: Number(options.userMessageId),
        }),
      });

      if (cancelled) return;

      if (res.status === 499) {
        return;
      }

      if (!res.ok) {
        const errBody = await res.text();
        callbacks.onError(
          new Error(res.statusText + (errBody ? `: ${errBody}` : ""))
        );
        return;
      }

      reader = res.body?.getReader() ?? null;
      if (!reader) {
        callbacks.onError(new Error("No response body"));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

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
      if (cancelled || isAbortError(e) || ended) return;
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return cancel;
}
