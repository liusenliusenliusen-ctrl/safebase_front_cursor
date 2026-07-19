import { useState, useCallback, useRef, useEffect } from "react";
import { Input, Button, Tooltip } from "antd";
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
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!sending) {
      areaRef.current?.focus();
    }
  }, [sending]);

  useEffect(() => {
    if (controlled && valueProp && !sending) {
      areaRef.current?.focus();
      const el = areaRef.current;
      if (el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  }, [controlled, valueProp, sending]);

  useEffect(() => {
    if (value && !sending) {
      areaRef.current?.focus();
      const el = areaRef.current;
      if (el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  }, [value, sending]);

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
    <div className="composer-dock">
      <div className="content-column">
        <div className="composer-shell">
          <TextArea
            ref={areaRef}
            className="composer-textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="跟我说些什么…"
            autoSize={{ minRows: 2, maxRows: 10 }}
            disabled={disabled || sending}
            style={{ flex: 1, maxHeight: 260 }}
            rows={2}
          />
          {sending && onStop ? (
            <Tooltip title="停止生成">
              <Button
                type="default"
                className="composer-action"
                icon={<StopOutlined />}
                onClick={onStop}
              >
                停止
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="Enter 发送 · Shift+Enter 换行">
              <Button
                type="primary"
                className="composer-action"
                icon={<SendOutlined />}
                onClick={send}
                disabled={!value.trim() || disabled}
                loading={sending}
              >
                发送
              </Button>
            </Tooltip>
          )}
        </div>
        <div className="composer-hint">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <span>{value.trim() ? `${value.trim().length} 字` : "慢慢写就好"}</span>
        </div>
      </div>
    </div>
  );
}
