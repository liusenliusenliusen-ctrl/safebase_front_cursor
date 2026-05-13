import type { Message, MessageRole } from "@/types";
import { supabase } from "@/lib/supabase";
import { auditReadAccess } from "@/lib/auditLog";

export async function getOrCreateDefaultSession(userId: string): Promise<string> {
  const { data: row, error: qErr } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (qErr) throw new Error(qErr.message);
  if (row?.id) return row.id as string;

  const { data: created, error: insErr } = await supabase
    .from("chat_sessions")
    .insert({ user_id: userId, title: "对话" })
    .select("id")
    .single();

  if (insErr) throw new Error(insErr.message);
  return created.id as string;
}

export async function insertChatMessage(
  sessionId: string,
  role: MessageRole,
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      role,
      content,
    })
    .select("id, role, content, created_at")
    .single();

  if (error) throw new Error(error.message);
  return {
    id: data.id as string,
    role: data.role as MessageRole,
    content: data.content as string,
    created_at: data.created_at as string,
  };
}

export async function fetchMessagesPage(params: {
  sessionId: string;
  subjectUserId: string;
  limit: number;
  before?: string;
  /** 内部为构造模型上下文重复拉取时设为 true，避免重复写 SELECT 审计 */
  skipAudit?: boolean;
}): Promise<{ messages: Message[]; hasMore: boolean }> {
  let q = supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("session_id", params.sessionId)
    .order("created_at", { ascending: false })
    .limit(params.limit + 1);

  if (params.before) {
    const { data: pivot } = await supabase
      .from("chat_messages")
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
    id: r.id as string,
    role: r.role as MessageRole,
    content: r.content as string,
    created_at: r.created_at as string,
  }));

  if (!params.skipAudit) {
    void auditReadAccess({
      subjectUserId: params.subjectUserId,
      table: "chat_messages",
      scope: params.before ? "list_page_older" : "list_page",
      detail: {
        session_id: params.sessionId,
        limit: params.limit,
        returned: messages.length,
      },
    });
  }

  return { messages, hasMore };
}

export async function deleteLastUserMessage(sessionId: string): Promise<void> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.role !== "user") return;

  const { error: delErr } = await supabase
    .from("chat_messages")
    .delete()
    .eq("id", data.id as string);
  if (delErr) throw new Error(delErr.message);
}

export function subscribeChatMessages(
  sessionId: string,
  onInsert: (row: {
    id: string;
    role: MessageRole;
    content: string;
    created_at: string;
  }) => void
) {
  const channel = supabase
    .channel(`chat_messages:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "chat_messages",
        filter: `session_id=eq.${sessionId}`,
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
