import { useEffect, useState, useCallback, useRef } from "react";
import { message } from "antd";
import { useAuthStore } from "@/stores/authStore";
import { deleteLastUserMessage, fetchMessages } from "@/api/messages";
import { streamChat } from "@/api/chat";
import type { Message } from "@/types";
import { MessageList } from "@/components/MessageList";
import { ChatInput } from "@/components/ChatInput";

const PAGE_SIZE = 20;
/** 流式区逐字显示间隔（毫秒），与服务端 chunk 大小无关 */
const STREAM_CHAR_MS = 28;

export function ChatPage() {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  /** 流式区当前已「打出」的纯文本；undefined 表示未在生成，完成后由 MessageBubble 一次性 Markdown */
  const [streamingContent, setStreamingContent] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const lastSentTextRef = useRef("");
  const optimisticUserMsgIdRef = useRef<number | null>(null);
  /** 服务端已收到的全文；界面每次只从其中多显示一字 */
  const streamReceivedRef = useRef("");
  /** 已向用户展示的字符数（与 streamReceived 同步递增，避免在 setState 里做副作用） */
  const streamDisplayedLenRef = useRef(0);
  /** 服务端流是否已结束（仍需把缓冲区逐字播完） */
  const streamEndedRef = useRef(false);

  const streamingUiActive = streamingContent !== undefined;

  useEffect(() => {
    if (!streamingUiActive || !user) return;
    const tick = () => {
      const full = streamReceivedRef.current;
      const len = streamDisplayedLenRef.current;
      if (len < full.length) {
        streamDisplayedLenRef.current = len + 1;
        setStreamingContent(full.slice(0, len + 1));
        return;
      }
      if (streamEndedRef.current) {
        streamEndedRef.current = false;
        streamReceivedRef.current = "";
        streamDisplayedLenRef.current = 0;
        setStreamingContent(undefined);
        optimisticUserMsgIdRef.current = null;
        void fetchMessages(user.id, { limit: 10 }).then((res) => {
          setMessages((prevMsgs) => {
            const withoutOptimistic = prevMsgs.filter((m) => m.id >= 0);
            const ids = new Set(withoutOptimistic.map((m) => m.id));
            const newOnes = res.messages.filter((m) => !ids.has(m.id));
            return [...withoutOptimistic, ...newOnes].sort(
              (a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        });
      }
    };
    const id = window.setInterval(tick, STREAM_CHAR_MS);
    return () => window.clearInterval(id);
  }, [streamingUiActive, user]);

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
      setDraft("");
      lastSentTextRef.current = text;
      setSending(true);
      streamReceivedRef.current = "";
      streamDisplayedLenRef.current = 0;
      streamEndedRef.current = false;
      setStreamingContent("");

      const userMsg: Message = {
        id: -Date.now(),
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      optimisticUserMsgIdRef.current = userMsg.id;
      setMessages((prev) => [...prev, userMsg]);

      streamChat(user.id, text, {
        onChunk: (chunk) => {
          streamReceivedRef.current += chunk;
        },
        onEnd: () => {
          setSending(false);
          streamEndedRef.current = true;
        },
        onError: (err) => {
          setSending(false);
          streamReceivedRef.current = "";
          streamDisplayedLenRef.current = 0;
          streamEndedRef.current = false;
          setStreamingContent(undefined);
          optimisticUserMsgIdRef.current = null;
          message.error(err.message || "发送失败");
        },
      })
        .then((stop) => {
          cancelStreamRef.current = stop;
        })
        .catch((err) => {
          setSending(false);
          streamReceivedRef.current = "";
          streamDisplayedLenRef.current = 0;
          streamEndedRef.current = false;
          setStreamingContent(undefined);
          optimisticUserMsgIdRef.current = null;
          message.error(err?.message || "发送失败");
        });
    },
    [user]
  );

  const handleStop = useCallback(() => {
    cancelStreamRef.current?.();
    cancelStreamRef.current = null;
    setSending(false);
    streamReceivedRef.current = "";
    streamDisplayedLenRef.current = 0;
    streamEndedRef.current = false;
    setStreamingContent(undefined);

    const text = lastSentTextRef.current;
    const optId = optimisticUserMsgIdRef.current;
    optimisticUserMsgIdRef.current = null;

    if (optId != null) {
      setMessages((prev) => prev.filter((m) => m.id !== optId));
    }
    setDraft(text);

    void deleteLastUserMessage().catch(() => {
      message.error("撤销本轮输入失败，请刷新页面同步");
      if (user) loadMessages();
    });
  }, [user, loadMessages]);

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
        onLoadMore={handleLoadMore}
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
