import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useAuthStore } from "@/stores/authStore";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { MainLayout } from "@/components/MainLayout";
import { AuthPage } from "@/pages/AuthPage";
import { ChatPage } from "@/pages/ChatPage";
import { DiaryPage } from "@/pages/DiaryPage";

const theme = {
  token: {
    colorPrimary: "#3f8f7f",
    colorInfo: "#3f8f7f",
    colorSuccess: "#3f8f7f",
    colorLink: "#3f8f7f",
    colorText: "#24302b",
    colorTextSecondary: "#4a5a53",
    colorBorder: "rgba(36, 48, 43, 0.14)",
    colorBgContainer: "#fffcf8",
    borderRadius: 12,
    fontFamily:
      '"Manrope", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    controlHeight: 40,
  },
  components: {
    Button: {
      primaryShadow: "0 2px 8px rgba(63, 143, 127, 0.28)",
      fontWeight: 600,
    },
    Input: {
      activeBorderColor: "#3f8f7f",
      hoverBorderColor: "#3f8f7f",
    },
  },
};

export default function App() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<ChatPage />} />
            <Route path="/diary" element={<DiaryPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
