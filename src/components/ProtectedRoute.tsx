import { Navigate, useLocation } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { Spin } from "antd";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, hydrated } = useAuthStore();
  const location = useLocation();

  if (!hydrated) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-page)",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
