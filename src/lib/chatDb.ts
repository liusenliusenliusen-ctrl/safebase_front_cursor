import type { Message, MessageRole } from "@/types";
import { apiFetch, apiJson } from "@/api/client";

export async function insertChatMessage(
  userId: string,
  role: MessageRole,
  content: string
): Promise<Message> {
  void userId;
  const data = await apiJson<{
    id: string;
    role: string;
    content: string;
    created_at: string;
  }>("/api/messages", {
    method: "POST",
    body: JSON.stringify({ role, content }),
  });
  return {
    id: String(data.id),
    role: data.role as MessageRole,
    content: data.content,
    created_at: data.created_at,
  };
}

export async function fetchMessagesPage(params: {
  userId: string;
  limit: number;
  before?: string;
}): Promise<{ messages: Message[]; hasMore: boolean }> {
  const qs = new URLSearchParams({ limit: String(params.limit) });
  if (params.before) qs.set("before", params.before);

  const data = await apiJson<{
    messages: Message[];
    has_more: boolean;
  }>(`/api/messages?${qs.toString()}`);

  return { messages: data.messages, hasMore: data.has_more };
}

export async function deleteLastUserMessage(userId: string): Promise<void> {
  void userId;
  await apiFetch("/api/messages/last-user", { method: "DELETE" });
}
