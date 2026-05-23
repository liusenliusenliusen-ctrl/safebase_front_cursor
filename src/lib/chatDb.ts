import type { Message, MessageRole } from "@/types";
import { supabase } from "@/lib/supabase";
import { auditReadAccess } from "@/lib/auditLog";

/** 单会话：按 user_id 读写 public.messages（与 Edge / Celery 同源） */
export async function insertChatMessage(
  userId: string,
  role: MessageRole,
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      user_id: userId,
      role,
      content,
    })
    .select("id, role, content, created_at")
    .single();

  if (error) throw new Error(error.message);
  return {
    id: String(data.id),
    role: data.role as MessageRole,
    content: data.content as string,
    created_at: data.created_at as string,
  };
}

export async function fetchMessagesPage(params: {
  userId: string;
  limit: number;
  before?: string;
  skipAudit?: boolean;
}): Promise<{ messages: Message[]; hasMore: boolean }> {
  let q = supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(params.limit + 1);

  if (params.before) {
    const { data: pivot } = await supabase
      .from("messages")
      .select("created_at")
      .eq("id", params.before)
      .maybeSingle();
    if (pivot?.created_at) {
      q = q.lt("created_at", pivot.created_at as string);
    }
  }

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const list = rows ?? [];
  const hasMore = list.length > params.limit;
  const slice = hasMore ? list.slice(0, params.limit) : list;

  const messages: Message[] = slice.reverse().map((r) => ({
    id: String(r.id),
    role: r.role as MessageRole,
    content: r.content as string,
    created_at: r.created_at as string,
  }));

  if (!params.skipAudit) {
    void auditReadAccess({
      subjectUserId: params.userId,
      table: "messages",
      scope: params.before ? "list_page_older" : "list_page",
      detail: { limit: params.limit, returned: messages.length },
    });
  }

  return { messages, hasMore };
}

export async function deleteLastUserMessage(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.role !== "user") return;

  const { error: delErr } = await supabase
    .from("messages")
    .delete()
    .eq("id", data.id as string);
  if (delErr) throw new Error(delErr.message);
}

export function subscribeChatMessages(
  userId: string,
  onInsert: (row: {
    id: string;
    role: MessageRole;
    content: string;
    created_at: string;
  }) => void
) {
  const channel = supabase
    .channel(`messages:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const r = payload.new as Record<string, unknown>;
        onInsert({
          id: String(r.id),
          role: r.role as MessageRole,
          content: String(r.content ?? ""),
          created_at: String(r.created_at),
        });
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
