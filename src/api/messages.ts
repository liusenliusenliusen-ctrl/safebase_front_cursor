import type { MessageListResponse } from "@/types";
import { apiClient } from "./client";

export async function fetchMessages(
  userId: string,
  options?: { before?: number; limit?: number }
): Promise<MessageListResponse> {
  const params: Record<string, string | number> = {
    user_id: userId,
    limit: options?.limit ?? 20,
  };
  if (options?.before != null) {
    params.before = options.before;
  }
  const { data } = await apiClient.get<MessageListResponse>("/api/messages", {
    params,
  });
  return data;
}

/** 删除当前用户最近一条用户消息（停止生成时撤销本轮已保存的输入） */
export async function deleteLastUserMessage(): Promise<void> {
  await apiClient.delete("/api/messages/last-user");
}
