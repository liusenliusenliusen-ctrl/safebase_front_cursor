# CPTSD 疗愈伴侣 - 前端

React + TypeScript 前端，与 [safebase_backend_cursor](../safebase_backend_cursor) 配套使用。

## 功能

- **认证**：注册、登录、持久化登录、路由保护
- **对话**：与 AI 疗愈对话，流式输出，历史消息分页加载（首屏 20 条，上滑加载更多）

## 技术栈

- React 18 + TypeScript
- Vite
- Ant Design 5、Zustand、React Router v6、react-hook-form + zod、axios、dayjs

## 开发

```bash
npm install
npm run dev
```

默认前端：<http://localhost:5173>。API 通过 Vite 代理到 `http://localhost:8000`（需先启动后端）。

## 构建

```bash
npm run build
npm run preview
```

## 环境变量

可选 `.env`：

- `VITE_API_BASE_URL`：后端 API 根地址。不设则使用相对路径 `/api`，依赖 Vite 代理或同域部署。

## 设计

- 背景色 `#F5F0E8`，点缀色 `#A7C7C9`
- 用户气泡 `#E3F2E8`，AI 气泡白底+轻阴影
- 大圆角、宽松留白、温和文案
