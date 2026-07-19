import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, Input, Button, Tabs, message } from "antd";
import { useAuthStore } from "@/stores/authStore";

const schema = z.object({
  username: z.string().min(3, "用户名至少 3 个字符").max(64, "用户名最多 64 个字符"),
  password: z.string().min(6, "密码至少 6 个字符").max(128, "密码最多 128 个字符"),
});

type FormValues = z.infer<typeof schema>;

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hydrated, login, register } = useAuthStore();
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
    if (hydrated && user) {
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    }
  }, [user, hydrated, navigate, location.state]);

  const onSubmit = async (values: FormValues) => {
    try {
      if (activeTab === "register") {
        await register(values.username.trim(), values.password);
        message.success("注册成功，欢迎你");
      } else {
        await login(values.username.trim(), values.password);
        message.success("登录成功");
      }
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "操作失败，请重试";
      message.error(msg);
    }
  };

  return (
    <div className="auth-stage">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="eyebrow">SAFEBASE</div>
          <h1>创伤疗愈伴侣</h1>
          <p>在这里，你被看见、被接纳</p>
          <p className="auth-boundary">陪伴与反思，不是诊疗</p>
        </div>
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
                <Input placeholder="用户名" size="large" autoComplete="username" {...field} />
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
                <Input.Password
                  placeholder="登录密码"
                  size="large"
                  autoComplete="current-password"
                  {...field}
                />
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
              style={{ borderRadius: 14, height: 46 }}
            >
              {activeTab === "login" ? "登录" : "注册"}
            </Button>
          </Form.Item>
        </form>
      </div>
    </div>
  );
}
