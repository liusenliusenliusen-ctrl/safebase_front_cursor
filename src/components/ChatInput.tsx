import { useState, useCallback } from "react";
import { Input, Button } from "antd";
import { SendOutlined, StopOutlined } from "@ant-design/icons";

const { TextArea } = Input;

interface ChatInputProps {
  /** 受控模式：与 onChange 同时传入则由父组件管理输入内容（用于停止后回填草稿） */
  value?: string;
  onChange?: (value: string) => void;
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
}

export function ChatInput({
  value: valueProp,
  onChange: onChangeProp,
  onSend,
  onStop,
  disabled,
  sending,
}: ChatInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const controlled = valueProp !== undefined && onChangeProp !== undefined;
  const value = controlled ? valueProp! : internalValue;
  const setValue = controlled ? onChangeProp! : setInternalValue;

  const send = useCallback(() => {
    const text = value.trim();
    if (!text || disabled || sending) return;
    onSend(text);
    if (!controlled) {
      setInternalValue("");
    }
  }, [value, onSend, disabled, sending, controlled]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      e.preventDefault();
      setValue(value + text);
    }
  };

  return (
    <div
      style={{
        padding: "12px 20px 20px",
        background: "var(--bg-page)",
        borderTop: "1px solid rgba(0,0,0,0.06)",
        display: "flex",
        alignItems: "flex-end",
        gap: 12,
      }}
    >
      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="在这里写下你想说的…"
        autoSize={{ minRows: 1, maxRows: 5 }}
        disabled={disabled}
        style={{
          flex: 1,
          borderRadius: 12,
          maxHeight: 120,
          resize: "none",
        }}
        rows={1}
      />
      {sending && onStop ? (
        <Button
          type="default"
          icon={<StopOutlined />}
          onClick={onStop}
          style={{ borderRadius: 12, height: 40 }}
        >
          停止
        </Button>
      ) : (
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={send}
          disabled={!value.trim() || disabled}
          loading={sending}
          style={{ borderRadius: 12, height: 40 }}
        >
          发送
        </Button>
      )}
    </div>
  );
}
