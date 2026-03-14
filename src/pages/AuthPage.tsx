import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, Input, Button, Tabs, message } from "antd";
import { useAuthStore } from "@/stores/authStore";
import { login, register } from "@/api/auth";

const schema = z.object({
  username: z.string().min(3, "用户名至少 3 个字符").max(64, "用户名最多 64 个字符"),
  password: z.string().min(6, "密码至少 6 个字符").max(128, "密码最多 128 个字符"),
});

type FormValues = z.infer<typeof schema>;

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setAuth } = useAuthStore();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
  });

  useEffect(() => {
    if (user) {
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    }
  }, [user, navigate, location.state]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (activeTab === "register") {
        const res = await register(values.username, values.password);
        setAuth(res.user, res.token);
        message.success("注册成功，欢迎你");
      } else {
        const res = await login(values.username, values.password);
        setAuth(res.user, res.token);
        message.success("登录成功");
      }
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "response" in e
        ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : "操作失败，请重试";
      message.error(msg || "操作失败，请重试");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg-page)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "#fff",
          borderRadius: 16,
          padding: 32,
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <h1
          style={{
            textAlign: "center",
            marginBottom: 8,
            fontSize: 22,
            fontWeight: 600,
            color: "#333",
          }}
        >
          CPTSD 疗愈伴侣
        </h1>
        <p
          style={{
            textAlign: "center",
            color: "#666",
            marginBottom: 24,
            fontSize: 14,
          }}
        >
          在这里，你被看见、被接纳
        </p>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => {
            setActiveTab(k as "login" | "register");
            reset();
          }}
          centered
          items={[
            { key: "login", label: "登录" },
            { key: "register", label: "注册" },
          ]}
        />
        <form onSubmit={handleSubmit(onSubmit)}>
          <Form.Item
            validateStatus={errors.username ? "error" : undefined}
            help={errors.username?.message}
          >
            <Controller
              name="username"
              control={control}
              render={({ field }) => (
                <Input placeholder="用户名" size="large" {...field} />
              )}
            />
          </Form.Item>
          <Form.Item
            validateStatus={errors.password ? "error" : undefined}
            help={errors.password?.message}
          >
            <Controller
              name="password"
              control={control}
              render={({ field }) => (
                <Input.Password placeholder="密码" size="large" {...field} />
              )}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={isSubmitting}
              style={{ borderRadius: 12, height: 44 }}
            >
              {activeTab === "login" ? "登录" : "注册"}
            </Button>
          </Form.Item>
        </form>
      </div>
    </div>
  );
}

