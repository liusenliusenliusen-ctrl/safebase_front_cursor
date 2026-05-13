import { useState } from "react";
import { Modal, Input, Button, Form, Typography } from "antd";
import { useVaultStore } from "@/stores/vaultStore";

const { Paragraph } = Typography;

export function VaultUnlockModal({
  open,
  onUnlocked,
}: {
  open: boolean;
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const unlockWithMasterPassword = useVaultStore((s) => s.unlockWithMasterPassword);
  const error = useVaultStore((s) => s.error);
  const clearError = useVaultStore((s) => s.clearError);

  const submit = async () => {
    if (password.length < 6) return;
    setLoading(true);
    clearError();
    await unlockWithMasterPassword(password);
    setLoading(false);
    if (useVaultStore.getState().unlocked) {
      setPassword("");
      onUnlocked();
    }
  };

  return (
    <Modal
      title="保险箱密码"
      open={open}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      destroyOnClose
    >
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        用于在本地派生加密密钥。密码仅保存在你的记忆中，不会上传到服务器；数据库只保存盐值与密文。
      </Paragraph>
      <Form layout="vertical" onFinish={() => void submit()}>
        <Form.Item
          label="主密码（至少 6 位）"
          validateStatus={error ? "error" : undefined}
          help={error || "首次登录将创建保险箱；再次登录请输入相同密码。"}
        >
          <Input.Password
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            placeholder="保险箱密码"
            autoComplete="new-password"
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading} disabled={password.length < 6}>
          解锁
        </Button>
      </Form>
    </Modal>
  );
}
