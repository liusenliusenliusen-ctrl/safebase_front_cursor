# 创伤疗愈伴侣 · 主站（React）

面向有创伤经历、正在自我疗愈的群体的陪伴产品主站：注册/登录、单会话对话、日记。定位宽于 CPTSD 诊断标签——未确诊但同样痛苦的幸存者也在服务范围内。数据与推理由 [safebase_backend_cursor](../safebase_backend_cursor) 的 Fastify API + Postgres 提供。

| 仓库 | 职责 |
|------|------|
| **本仓库** | React 主站（:5173） |
| [safebase_backend_cursor](../safebase_backend_cursor) | API、RAG 对话、Schema、夜间批处理 |
| [safebase_admin_cursor](../safebase_admin_cursor) | 管理后台（:5174） |

**开发指南：** [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)  
**生产部署：** [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)（含 `scripts/deploy-upload.sh` 一键部署）  
**安全演进：** [docs/SECURITY_EVOLUTION.md](./docs/SECURITY_EVOLUTION.md)（DB 访问控制与隐私分阶段计划）

## 本地开发

```bash
# 1. 后端仓库
cd safebase_backend_cursor
docker compose up -d          # Postgres（Docker，:5433）
cp .env.example .env          # 填 JWT_SECRET、OPENROUTER_API_KEY、ADMIN_SECRET
npm install && npm run dev    # API :8000

# 2. 本仓库
cp .env.example .env          # VITE_API_BASE_URL 留空（Vite 代理 /api → :8000）
npm install && npm run dev    # :5173
```

默认 <http://localhost:5173>。

## 功能入口

| 功能 | 页面 | API |
|------|------|-----|
| 注册/登录 | `AuthPage` | `/api/auth/*` |
| 对话 | `ChatPage` | `/api/messages`、`/api/chat/stream` |
| 日记 | `DiaryPage` | `/api/diaries` |
| 注销账号 | `MainLayout` | `DELETE /api/account` |

## 技术栈

React 18、TypeScript、Vite 5、Ant Design 5、Zustand、React Router 6

## 目录

```text
src/
  api/       client.ts（JWT）、chatStream.ts（SSE）
  lib/       chatDb.ts、diaryDb.ts
  pages/     AuthPage、ChatPage、DiaryPage
  stores/    authStore、chatStore
```
