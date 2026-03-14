import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button, message } from "antd";
import { LogoutOutlined } from "@ant-design/icons";
import { useAuthStore } from "@/stores/authStore";
import { fetchMessages } from "@/api/messages";
import { streamChat } from "@/api/chat";
import type { Message } from "@/types";
import { MessageList } from "@/components/MessageList";
import { ChatInput } from "@/components/ChatInput";

const PAGE_SIZE = 20;

export function ChatPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const cancelStreamRef = useRef<(() => void) | null>(null);

  const loadMessages = useCallback(
    async (before?: number) => {
      if (!user) return;
      const isLoadMore = before != null;
      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await fetchMessages(user.id, {
          before,
          limit: PAGE_SIZE,
        });
        setHasMore(res.hasMore);
        if (isLoadMore) {
          setMessages((prev) => [...res.messages, ...prev]);
        } else {
          setMessages(res.messages);
        }
      } catch (e) {
        message.error("加载消息失败");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (user) loadMessages();
  }, [user, loadMessages]);

  const handleLoadMore = useCallback(() => {
    const oldest = messages[0];
    if (!user || !oldest || loadingMore || !hasMore) return;
    loadMessages(oldest.id);
  }, [user, messages, loadingMore, hasMore, loadMessages]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!user) return;
      setSending(true);
      setStreamingContent("");

      // 乐观追加用户消息
      const userMsg: Message = {
        id: -Date.now(),
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // 启动流式请求，但不阻塞 UI
      streamChat(user.id, text, {
        onChunk: (chunk) => {
          setStreamingContent((prev) => (prev ?? "") + chunk);
        },
        onEnd: () => {
          setSending(false);
          setStreamingContent(undefined);
          // 拉取最新几条，合并并去掉乐观更新的临时消息
          fetchMessages(user.id, { limit: 10 }).then((res) => {
            setMessages((prev) => {
              const withoutOptimistic = prev.filter((m) => m.id >= 0);
              const ids = new Set(withoutOptimistic.map((m) => m.id));
              const newOnes = res.messages.filter((m) => !ids.has(m.id));
              const combined = [...withoutOptimistic, ...newOnes].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              );
              return combined;
            });
          });
        },
        onError: (err) => {
          setSending(false);
          setStreamingContent(undefined);
          message.error(err.message || "发送失败");
        },
      })
        .then((stop) => {
          cancelStreamRef.current = stop;
        })
        .catch((err) => {
          setSending(false);
          setStreamingContent(undefined);
          message.error(err?.message || "发送失败");
        });
    },
    [user]
  );

  const handleStop = useCallback(() => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/auth", { replace: true });
  };

  if (!user) return null;

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-page)",
      }}
    >
      <header
        style={{
          padding: "12px 20px",
          background: "#fff",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 500 }}>{user.username}</span>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={handleLogout}
          style={{ color: "#666" }}
        >
          退出登录
        </Button>
      </header>
      <MessageList
        messages={messages}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={handleLoadMore}
        streamingContent={streamingContent}
      />
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        disabled={loading}
        sending={sending}
      />
    </div>
  );
}
