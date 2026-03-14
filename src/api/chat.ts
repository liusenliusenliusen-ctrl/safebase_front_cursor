const baseURL = import.meta.env.VITE_API_BASE_URL ?? "";

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onEnd: () => void;
  onError: (err: Error) => void;
}

export async function streamChat(
  userId: string,
  message: string,
  callbacks: StreamCallbacks
): Promise<() => void> {
  const token = localStorage.getItem("token");
  const url = `${baseURL || ""}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ user_id: userId, message }),
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
      callbacks.onEnd();
    } catch (e) {
      if (!cancelled) callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return () => {
    cancelled = true;
    reader.cancel();
  };
}
