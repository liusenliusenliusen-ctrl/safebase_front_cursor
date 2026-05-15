# CPTSD 疗愈伴侣 · 前端

React + TypeScript 主站。**数据与认证已落在 Supabase**（Postgres + Auth + Row Level Security），对话流式由 **Supabase Edge Function** `stream-chat` 提供。本仓库内含 `supabase/`（迁移与函数），与 [safebase_backend_cursor](../safebase_backend_cursor)（可选：管理 API、RAG 批处理、Celery）配合使用。

## 功能概览

- **认证**：Supabase Auth（注册 / 登录 / 会话）
- **对话**：Edge Function 流式 SSE；会话与消息存于 Supabase（含 Realtime 等能力）
- **日记 / 保险库**：客户端加密（E2EE）与 Supabase 存储协同（详见代码与迁移）

## 技术栈

- React 18、TypeScript、Vite
- `@supabase/supabase-js`
- Ant Design 5、Zustand、React Router v6、react-hook-form + zod、dayjs

## 本地开发

### 1. 启动 Supabase（CLI）

需安装 [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)。在项目根目录：

```bash
supabase start
```

记下终端输出的 **API URL** 与 **anon key**。

### 2. 环境变量

复制 `.env.example` 为 `.env`，填写：

- `VITE_SUPABASE_URL`：如本地 `http://127.0.0.1:54321`
- `VITE_SUPABASE_ANON_KEY`：Dashboard / `supabase status` 中的 **anon public** key（勿把 `service_role` 写进前端）

### 3. Edge Function 密钥（对话）

函数 `supabase/functions/stream-chat` 通过 **OpenRouter** 调用模型（与后端 FastAPI 一致，均为兼容 OpenAI 的 `chat/completions` 流式接口）。必填 Secret：

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
# 可选（有默认值）
supabase secrets set OPENROUTER_CHAT_MODEL=deepseek/deepseek-chat
# supabase secrets set OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# supabase secrets set OPENROUTER_HTTP_REFERER=https://你的站点
# supabase secrets set OPENROUTER_APP_TITLE=Safebase
```

本地调试：可将 `supabase/functions/stream-chat/.env.example` 复制为同目录 `.env`，或使用 `supabase secrets set --local …`。然后：

```bash
supabase functions serve stream-chat --no-verify-jwt   # 仅本地调试时按需使用
```

生产环境在 Supabase Dashboard → **Edge Functions → Secrets** 中配置上述变量（勿把 Key 写进前端 `.env`）。

### 4. 安装与启动前端

```bash
npm install
npm run dev
```

默认：<http://localhost:5173>。

`vite.config.ts` 里仍将 `/api` 代理到 `http://127.0.0.1:8000`，供**可选**的 FastAPI（管理端、`npm run simulate-chat` 等）使用；主流程不依赖该代理。主站对话（Edge `stream-chat`）与可选后端 [safebase_backend_cursor](../safebase_backend_cursor) 的 LLM / embedding **均只使用 OpenRouter**；分别在各处配置 Secrets / `.env`（见上节与本仓库 `supabase/functions/stream-chat/.env.example`、后端 `.env.example`）。

## 数据库迁移

SQL 迁移位于 `supabase/migrations/`。本地在 `supabase start` 时会应用；重置数据库：

```bash
supabase db reset
```

从旧自建 Postgres 迁到 Supabase 时，可使用 `scripts/migrate_legacy_to_supabase.py`（需 `LEGACY_DATABASE_URL` 与 `TARGET_DATABASE_URL`，且 `auth.users.id` 与旧库用户一致）。详见脚本内注释。

## 构建

```bash
npm run build
npm run preview
```

## 设计

- 背景色 `#F5F0E8`，点缀色 `#A7C7C9`
- 用户气泡 `#E3F2E8`，AI 气泡白底与轻阴影
- 大圆角、宽松留白、温和文案
