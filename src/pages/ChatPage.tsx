import { useEffect, useState, useCallback } from "react";
import { message } from "antd";
import { useAuthStore } from "@/stores/authStore";
import {
  fetchMessagesPage,
} from "@/lib/chatDb";
import { useChatStore } from "@/stores/chatStore";
import type { Message } from "@/types";
import { MessageList } from "@/components/MessageList";
import { ChatInput } from "@/components/ChatInput";

const PAGE_SIZE = 20;

export function ChatPage() {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const {
    draft,
    sending,
    streamingContent,
    waitingForAssistant,
    optimisticUserMsgId,
    needsSync,
    errorMessage,
    setDraft,
    sendChatMessage,
    stopMessage,
    markSynced,
    clearError,
  } = useChatStore();

  const loadInitial = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { messages: rows, hasMore: more } = await fetchMessagesPage({
        userId: user.id,
        limit: PAGE_SIZE,
      });
      setMessages(rows);
      setHasMore(more);
    } catch {
      message.error("加载消息失败");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    const oldest = messages[0];
    if (!user || !oldest || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const { messages: older, hasMore: more } = await fetchMessagesPage({
        userId: user.id,
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
  }, [user, messages, loadingMore, hasMore]);

  useEffect(() => {
    if (!user || !needsSync) return;
    markSynced();
    void fetchMessagesPage({
      userId: user.id,
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
  }, [user, needsSync, markSynced]);

  useEffect(() => {
    if (!errorMessage) return;
    message.error(errorMessage);
    clearError();
  }, [errorMessage, clearError]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!user) return;
      const plain = text.trim();
      if (!plain) return;

      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticMsg: Message = {
        id: optimisticId,
        role: "user",
        content: plain,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) =>
        [...prev, optimisticMsg].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
      );

      try {
        const userMsg = await sendChatMessage(user.id, plain);
        if (!userMsg) {
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          return;
        }
        setMessages((prev) =>
          prev
            .map((m) => (m.id === optimisticId ? userMsg : m))
            .sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime()
            )
        );
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        message.error(e instanceof Error ? e.message : "发送失败");
      }
    },
    [user, sendChatMessage]
  );

  const handleStop = useCallback(() => {
    if (optimisticUserMsgId != null) {
      setMessages((prev) =>
        prev.filter(
          (m) =>
            m.id !== optimisticUserMsgId &&
            !m.id.startsWith("optimistic-")
        )
      );
    }
    void stopMessage(user?.id);
  }, [optimisticUserMsgId, stopMessage, user?.id]);

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
        waitingForAssistant={waitingForAssistant}
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
