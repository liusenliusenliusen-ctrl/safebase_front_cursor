import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button, Dropdown, Input, Modal, message } from "antd";
import {
  BookOutlined,
  InfoCircleOutlined,
  LogoutOutlined,
  MessageOutlined,
  MoreOutlined,
  UserDeleteOutlined,
} from "@ant-design/icons";
import { useAuthStore } from "@/stores/authStore";
import { apiFetch } from "@/api/client";

const WELCOME_KEY = "safebase_welcome_seen";

export function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  const isDiary = location.pathname.startsWith("/diary");

  useEffect(() => {
    try {
      if (localStorage.getItem(WELCOME_KEY) !== "1") {
        setWelcomeOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const dismissWelcome = () => {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      /* ignore */
    }
    setWelcomeOpen(false);
  };

  const handleLogout = () => {
    logout();
    navigate("/auth", { replace: true });
  };

  const handleConfirmDeleteAccount = async () => {
    if (deletePassword.length < 6) {
      message.warning("请输入至少 6 位字符以确认清除数据");
      return Promise.reject();
    }
    setDeletingAccount(true);
    try {
      const res = await apiFetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || res.statusText);
      }
      message.success("账号及全部数据已删除");
      setDeleteModalOpen(false);
      setDeletePassword("");
      logout();
      navigate("/auth", { replace: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "操作失败";
      message.error(msg);
      return Promise.reject(e);
    } finally {
      setDeletingAccount(false);
    }
  };

  if (!user) return null;

  return (
    <div className={`app-shell${isDiary ? " is-diary" : " is-chat"}`}>
      <header className="app-header">
        <div className="partner-identity">
          <span className="brand-mark">Safebase</span>
          <div className="partner-copy">
            <span className="partner-name">疗愈伴侣</span>
            <span className="partner-presence">我在</span>
          </div>
        </div>

        <div className="header-actions">
          <span className="header-username" title={user.username}>
            {user.username}
          </span>
          <Dropdown
            menu={{
              items: [
                {
                  key: "memory",
                  icon: <InfoCircleOutlined />,
                  label: "我们如何记得你",
                  onClick: () => setMemoryModalOpen(true),
                },
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "退出登录",
                  onClick: handleLogout,
                },
                { type: "divider" },
                {
                  key: "delete",
                  danger: true,
                  icon: <UserDeleteOutlined />,
                  label: "注销账号",
                  onClick: () => {
                    setDeletePassword("");
                    setDeleteModalOpen(true);
                  },
                },
              ],
            }}
            placement="bottomRight"
            trigger={["click"]}
          >
            <Button
              type="text"
              icon={<MoreOutlined />}
              aria-label="账号菜单"
              className="header-menu-btn"
            />
          </Dropdown>
        </div>
      </header>

      <div className="app-main">
        <Outlet />
      </div>

      <nav className="bottom-tabs" aria-label="主导航">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `bottom-tab${isActive ? " is-active" : ""}`}
        >
          <MessageOutlined className="bottom-tab-icon" />
          <span>对话</span>
        </NavLink>
        <NavLink
          to="/diary"
          className={({ isActive }) => `bottom-tab${isActive ? " is-active" : ""}`}
        >
          <BookOutlined className="bottom-tab-icon" />
          <span>日记</span>
        </NavLink>
      </nav>

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
        <p style={{ marginBottom: 12, color: "var(--ink-soft)" }}>
          将永久删除当前账号及全部对话、日记与记忆数据，且无法恢复。输入任意 6
          位以上字符以确认。
        </p>
        <Input.Password
          placeholder="确认"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          autoComplete="current-password"
          onPressEnter={() => void handleConfirmDeleteAccount()}
        />
      </Modal>

      <Modal
        title="我们如何记得你"
        open={memoryModalOpen}
        onCancel={() => setMemoryModalOpen(false)}
        footer={
          <Button type="primary" onClick={() => setMemoryModalOpen(false)}>
            知道了
          </Button>
        }
        destroyOnClose
      >
        <div className="memory-explain">
          <p>
            你可以在这里慢慢说，也可以写日记。对话与日记是两个分开的空间，但伴侣在回复时，会温柔地考虑你写下的相关内容。
          </p>
          <p>
            我们会在后台慢慢形成对你的理解——无需你每次确认。这不是诊疗，也不是监控，而是为了让陪伴更连贯、更懂你。
          </p>
          <p className="memory-explain-note">你可以随时退出登录，或注销账号以永久删除全部数据。</p>
        </div>
      </Modal>

      <Modal
        title={null}
        open={welcomeOpen}
        onCancel={dismissWelcome}
        footer={null}
        closable={false}
        centered
        className="welcome-modal"
        width={400}
      >
        <div className="welcome-panel">
          <p className="welcome-eyebrow">欢迎</p>
          <h2>慢慢说，也可以写下来</h2>
          <p>
            对话是与疗愈伴侣的陪伴空间；日记是留给自己的安静角落。两者分开，但写下的内容会帮助伴侣更懂你。
          </p>
          <p className="welcome-note">陪伴与反思，不是诊疗。</p>
          <Button type="primary" size="large" block onClick={dismissWelcome}>
            开始
          </Button>
        </div>
      </Modal>
    </div>
  );
}
