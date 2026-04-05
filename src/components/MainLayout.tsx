import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import axios from "axios";
import { Button, Input, Modal, Space, message } from "antd";
import { LogoutOutlined, UserDeleteOutlined } from "@ant-design/icons";
import { useAuthStore } from "@/stores/authStore";
import { deleteAccount } from "@/api/auth";

export function MainLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/auth", { replace: true });
  };

  const handleConfirmDeleteAccount = async () => {
    if (deletePassword.length < 6) {
      message.warning("请输入至少 6 位密码以确认注销");
      return Promise.reject();
    }
    setDeletingAccount(true);
    try {
      await deleteAccount(deletePassword);
      message.success("账号已注销");
      setDeleteModalOpen(false);
      setDeletePassword("");
      logout();
      navigate("/auth", { replace: true });
    } catch (e: unknown) {
      if (axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object") {
        const d = (e.response.data as { detail?: unknown }).detail;
        const msg =
          typeof d === "string"
            ? d
            : Array.isArray(d)
              ? d
                  .map((x) =>
                    typeof x === "object" && x && "msg" in x ? String((x as { msg: unknown }).msg) : String(x)
                  )
                  .join("; ")
              : "注销失败，请检查密码或网络";
        message.error(msg);
      } else {
        message.error("注销失败，请检查网络");
      }
      return Promise.reject(e);
    } finally {
      setDeletingAccount(false);
    }
  };

  if (!user) return null;

  const navLinkStyle = ({ isActive }: { isActive: boolean }) => ({
    padding: "8px 18px",
    borderRadius: 999,
    fontWeight: 500,
    fontSize: 15,
    textDecoration: "none",
    color: isActive ? "#fff" : "var(--nav-inactive)",
    background: isActive ? "var(--accent)" : "transparent",
    transition: "background 0.2s, color 0.2s",
  });

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
          padding: "10px 16px 10px 20px",
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: "#3d4f4f", letterSpacing: 0.3 }}>
            Safebase
          </span>
          <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <NavLink to="/" end style={navLinkStyle}>
              对话
            </NavLink>
            <NavLink to="/diary" style={navLinkStyle}>
              我的日记
            </NavLink>
          </nav>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, color: "#888" }}>{user.username}</span>
          <Space>
            <Button
              type="text"
              danger
              icon={<UserDeleteOutlined />}
              onClick={() => {
                setDeletePassword("");
                setDeleteModalOpen(true);
              }}
              style={{ color: "#cf1322" }}
            >
              注销账号
            </Button>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              style={{ color: "var(--nav-inactive)" }}
            >
              退出登录
            </Button>
          </Space>
        </div>
      </header>

      <Modal
        title="注销账号"
        open={deleteModalOpen}
        onCancel={() => {
          setDeleteModalOpen(false);
          setDeletePassword("");
        }}
        onOk={handleConfirmDeleteAccount}
        okText="确认注销"
        okButtonProps={{ danger: true, loading: deletingAccount }}
        cancelButtonProps={{ disabled: deletingAccount }}
        destroyOnClose
      >
        <p style={{ marginBottom: 12, color: "#666" }}>
          将永久删除本账号及全部对话、日记、画像、摘要与锚点等数据，且不可恢复。请输入登录密码以确认。
        </p>
        <Input.Password
          placeholder="登录密码"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          autoComplete="current-password"
          onPressEnter={() => void handleConfirmDeleteAccount()}
        />
      </Modal>

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Outlet />
      </div>
    </div>
  );
}
