import { useEffect, useState, useCallback } from "react";
import { message } from "antd";
import { useAuthStore } from "@/stores/authStore";
import {
  fetchMessagesPage,
  getOrCreateDefaultSession,
  insertChatMessage,
  subscribeChatMessages,
} from "@/lib/chatDb";
import { useChatStore } from "@/stores/chatStore";
import type { Message } from "@/types";
import { MessageList } from "@/components/MessageList";
import { ChatInput } from "@/components/ChatInput";

const PAGE_SIZE = 20;

export function ChatPage() {
  const { user } = useAuthStore();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const {
    draft,
    sending,
    streamingContent,
    optimisticUserMsgId,
    needsSync,
    errorMessage,
    setDraft,
    setOptimisticUserMsgId,
    setSessionId: setStoreSessionId,
    streamReply,
    stopMessage,
    markSynced,
    clearError,
  } = useChatStore();

  const loadInitial = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const sid = await getOrCreateDefaultSession(user.id);
      setSessionId(sid);
      setStoreSessionId(sid);
      const { messages: rows, hasMore: more } = await fetchMessagesPage({
        sessionId: sid,
        subjectUserId: user.id,
        limit: PAGE_SIZE,
      });
      setMessages(rows);
      setHasMore(more);
    } catch {
      message.error("加载消息失败");
    } finally {
      setLoading(false);
    }
  }, [user, setStoreSessionId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    const oldest = messages[0];
    if (!user || !sessionId || !oldest || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const { messages: older, hasMore: more } = await fetchMessagesPage({
        sessionId,
        subjectUserId: user.id,
        limit: PAGE_SIZE,
        before: oldest.id,
      });
      setHasMore(more);
      setMessages((prev) => [...older, ...prev]);
    } catch {
      message.error("加载更多失败");
    } finally {
      setLoadingMore(false);
    }
  }, [user, sessionId, messages, loadingMore, hasMore]);

  useEffect(() => {
    if (!user || !needsSync || !sessionId) return;
    markSynced();
    void fetchMessagesPage({
      sessionId,
      subjectUserId: user.id,
      limit: 30,
    }).then(({ messages: fresh }) => {
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of fresh) {
          byId.set(m.id, m);
        }
        return [...byId.values()].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
    });
  }, [user, needsSync, sessionId, markSynced]);

  useEffect(() => {
    if (!errorMessage) return;
    message.error(errorMessage);
    clearError();
  }, [errorMessage, clearError]);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribeChatMessages(sessionId, (row) => {
      const msg: Message = {
        id: row.id,
        role: row.role,
        content: row.content,
        created_at: row.created_at,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
    });
    return unsub;
  }, [sessionId]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!user || !sessionId) return;
      try {
        const userMsg = await insertChatMessage(sessionId, "user", text);
        setMessages((prev) =>
          [...prev, userMsg].sort(
            (a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          )
        );
        setOptimisticUserMsgId(userMsg.id);
        await streamReply(sessionId, user.id, text);
      } catch (e) {
        message.error(e instanceof Error ? e.message : "发送失败");
      }
    },
    [user, sessionId, streamReply, setOptimisticUserMsgId]
  );

  const handleStop = useCallback(() => {
    if (optimisticUserMsgId != null) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsgId));
    }
    void stopMessage();
  }, [optimisticUserMsgId, stopMessage]);

  if (!user) return null;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-page)",
      }}
    >
      <MessageList
        messages={messages}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        streamingContent={streamingContent}
      />
      <ChatInput
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onStop={handleStop}
        disabled={loading}
        sending={sending}
      />
    </div>
  );
}
