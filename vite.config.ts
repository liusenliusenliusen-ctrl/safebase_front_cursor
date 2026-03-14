import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // 使用 127.0.0.1 避免 localhost 解析为 IPv6 (::1) 导致 ECONNREFUSED
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
