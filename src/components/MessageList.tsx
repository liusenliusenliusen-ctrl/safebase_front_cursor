import { useRef, useEffect } from "react";
import type { Message } from "@/types";
import dayjs from "dayjs";
import { MessageBubble } from "./MessageBubble";
import { Spin } from "antd";

interface MessageListProps {
  messages: Message[];
  loading?: boolean;
  loadingMore?: boolean;
  streamingContent?: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export function MessageList({
  messages,
  loading,
  loadingMore,
  streamingContent,
  onLoadMore,
  hasMore,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);

  // 首次加载或加载更多时保持滚动位置
  useEffect(() => {
    if (!listRef.current || !loadingMore) return;
    const el = listRef.current;
    const newScrollHeight = el.scrollHeight;
    const delta = newScrollHeight - prevScrollHeightRef.current;
    if (delta > 0) {
      el.scrollTop = prevScrollTopRef.current + delta;
    }
    prevScrollHeightRef.current = el.scrollHeight;
    prevScrollTopRef.current = el.scrollTop;
  }, [messages.length, loadingMore]);

  // 加载更多：IntersectionObserver
  useEffect(() => {
    if (!onLoadMore || !hasMore || loadingMore || loading) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: listRef.current, rootMargin: "100px", threshold: 0 }
    );
    ob.observe(sentinel);
    return () => ob.disconnect();
  }, [onLoadMore, hasMore, loadingMore, loading]);

  // 新消息或流式内容时滚到底部
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, streamingContent]);

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  let lastDate = "";
  return (
    <div
      ref={listRef}
      style={{
        flex: 1,
        overflow: "auto",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {hasMore && (
        <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />
      )}
      {loadingMore && (
        <div style={{ textAlign: "center", padding: 12 }}>
          <Spin size="small" />
        </div>
      )}
      {messages.map((msg) => {
        const dateStr = dayjs(msg.created_at).format("YYYY-MM-DD");
        const showDate = dateStr !== lastDate;
        if (showDate) lastDate = dateStr;
        return (
          <MessageBubble key={msg.id} message={msg} showDate={showDate} />
        );
      })}
      {streamingContent !== undefined && streamingContent !== "" && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              maxWidth: "80%",
              padding: "12px 16px",
              borderRadius: 16,
              background: "#fff",
              boxShadow: "var(--shadow-soft)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {streamingContent}
            <span
              className="stream-cursor"
              style={{
                display: "inline-block",
                width: 2,
                height: "1em",
                background: "var(--accent)",
                marginLeft: 2,
                animation: "blink 1s step-end infinite",
                verticalAlign: "text-bottom",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
