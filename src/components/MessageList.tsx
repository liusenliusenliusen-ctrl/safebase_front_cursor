import { useRef, useEffect } from "react";
import type { Message } from "@/types";
import dayjs from "dayjs";
import { MessageBubble } from "./MessageBubble";
import { Spin } from "antd";

export const CHAT_STARTERS = [
  {
    id: "vent",
    label: "说说近况",
    text: "我想跟你说说最近的情况。",
  },
  {
    id: "reflect",
    label: "理清一种感觉",
    text: "我心里有一种说不清的感觉，想和你一起理一理。",
  },
] as const;

interface MessageListProps {
  messages: Message[];
  loading?: boolean;
  loadingMore?: boolean;
  /**
   * 流式阶段：助手回复原文（纯文本逐字显示）；undefined 表示未在生成。
   * 完成后由 MessageBubble + Markdown 一次性渲染，此处不再使用 Markdown。
   */
  streamingContent?: string;
  /** 用户消息已显示，等待模型首 token */
  waitingForAssistant?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
  /** 空态开场芯片：填入输入框 */
  onPickStarter?: (text: string) => void;
}

export function MessageList({
  messages,
  loading,
  loadingMore,
  streamingContent,
  waitingForAssistant,
  onLoadMore,
  hasMore,
  onPickStarter,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);

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

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, streamingContent, waitingForAssistant]);

  if (loading) {
    return (
      <div className="chat-loading">
        <Spin size="large" />
      </div>
    );
  }

  if (messages.length === 0 && !waitingForAssistant && streamingContent === undefined) {
    return (
      <div className="empty-stage chat-empty">
        <div className="empty-breath" aria-hidden />
        <h2>慢慢说，我在听</h2>
        <p>你可以写下今天的感受、一段关系，或任何想被接住的瞬间。不必一次说完。</p>
        {onPickStarter && (
          <div className="starter-chips" role="group" aria-label="可选开场">
            {CHAT_STARTERS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="starter-chip"
                onClick={() => onPickStarter(s.text)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const waitingOnly = waitingForAssistant && !streamingContent;

  let lastDate = "";
  return (
    <div ref={listRef} className="chat-scroll">
      <div className="content-column" style={{ display: "flex", flexDirection: "column" }}>
        {hasMore && <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />}
        {loadingMore && (
          <div className="chat-load-more">
            <Spin size="small" />
          </div>
        )}
        {messages.map((msg) => {
          const dateStr = dayjs(msg.created_at).format("YYYY-MM-DD");
          const showDate = dateStr !== lastDate;
          if (showDate) lastDate = dateStr;
          return <MessageBubble key={msg.id} message={msg} showDate={showDate} />;
        })}
        {(waitingForAssistant || streamingContent !== undefined) && (
          <div className="msg-row is-assistant">
            <div className="msg-bubble is-assistant">
              {waitingOnly ? (
                <span className="thinking-status">
                  <span className="thinking-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span className="thinking-label">
                    正在认真听，想得比较深，可能稍久…
                  </span>
                </span>
              ) : (
                <>
                  <span className="stream-plain">{streamingContent}</span>
                  <span className="stream-cursor" aria-hidden />
                </>
              )}
            </div>
            {waitingOnly && (
              <div className="thinking-hint">需要的话可以点下方「停止」</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
