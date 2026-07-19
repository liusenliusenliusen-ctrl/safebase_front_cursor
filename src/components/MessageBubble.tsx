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
    <div className={`msg-row ${isUser ? "is-user" : "is-assistant"}`}>
      {showDate && (
        <div className="date-chip">{dayjs(message.created_at).format("YYYY年M月D日")}</div>
      )}
      <div className={`msg-bubble ${isUser ? "is-user" : "is-assistant"}`}>
        {isUser ? message.content : <MarkdownText content={message.content} />}
      </div>
      <div className="msg-meta">{dayjs(message.created_at).format("HH:mm")}</div>
    </div>
  );
}
