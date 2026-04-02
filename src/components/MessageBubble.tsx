import type { Message } from "@/types";
import dayjs from "dayjs";
import { MarkdownText } from "./MarkdownText";

interface MessageBubbleProps {
  message: Message;
  showDate?: boolean;
}

export function MessageBubble({ message, showDate }: MessageBubbleProps) {
  const isUser = message.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 12,
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
      }}
    >
      {showDate && (
        <div
          style={{
            fontSize: 12,
            color: "#999",
            marginBottom: 8,
          }}
        >
          {dayjs(message.created_at).format("YYYY年MM月DD日")}
        </div>
      )}
      <div
        style={{
          maxWidth: "80%",
          padding: "12px 16px",
          borderRadius: 16,
          background: isUser ? "var(--user-bubble)" : "#fff",
          boxShadow: isUser ? "none" : "var(--shadow-soft)",
          whiteSpace: isUser ? "pre-wrap" : "normal",
          wordBreak: "break-word",
        }}
      >
        {isUser ? message.content : <MarkdownText content={message.content} />}
      </div>
    </div>
  );
}
