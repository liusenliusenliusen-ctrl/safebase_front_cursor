# CPTSD 疗愈伴侣 · 主站（Supabase + React）

面向幸存者的陪伴产品主站：认证、单会话对话、日记、长期记忆（画像 / 摘要 / 锚点）的数据均落在 **Supabase Postgres**，对话推理由 **Edge Function `stream-chat`** 完成。本仓库包含前端、`supabase/migrations` 与 Edge Functions。

配套服务（非主站运行时依赖）：

- [safebase_backend_cursor](../safebase_backend_cursor) — Celery 定时任务 + 管理 API
- [safebase_admin_cursor](../safebase_admin_cursor) — 运营查看用户与对话

## 架构总览

```text
┌─────────────────────────────────────────────────────────────────┐
│  浏览器 (localhost:5173)                                         │
│  React · Zustand · @supabase/supabase-js                          │
└────────────┬───────────────────────────────┬────────────────────┘
             │ JWT (anon + session)           │ Edge HTTPS
             ▼                                ▼
┌────────────────────────────┐   ┌──────────────────────────────┐
│  Supabase PostgREST + RLS   │   │  Edge Functions               │
│  messages, diaries,         │   │  stream-chat (RAG + 流式)     │
│  profiles, summaries,       │   │  index-diary (日记 embedding) │
│  anchors, user_crypto, …    │   └──────────────┬───────────────┘
└────────────┬───────────────┘                  │
             │                                   ▼
             │                          OpenRouter (chat + embedding)
             │
             │  同一 Postgres（直连，绕过 RLS）
             ▼
┌────────────────────────────┐
│  safebase_backend_cursor    │
│  Celery + /api/admin/*      │
└────────────────────────────┘
```

主站**不再**请求 FastAPI 的 `/api/auth`、`/api/chat`、`/api/messages`、`/api/diary`；`vite` 也**未**配置对 `:8000` 的代理。

## 功能与代码入口

| 功能 | 页面 / 模块 | 数据与 API |
|------|-------------|------------|
| 注册 / 登录 | `src/pages/AuthPage.tsx` | Supabase Auth；用户名映射为内部邮箱（`lib/authEmail.ts`） |
| 对话 | `src/pages/ChatPage.tsx`、`stores/chatStore.ts` | `public.messages`；流式 `src/api/chatStream.ts` → `stream-chat` |
| 日记 | `src/pages/DiaryPage.tsx` | `public.diaries`（`lib/diaryDb.ts`）；保存后触发 `index-diary` |
| 注销数据 | `MainLayout` 内 Modal | RPC `delete_my_data()` |
| 读审计 | `lib/auditLog.ts` | RPC `audit_read_access` |

路由：`/` 对话，`/diary` 日记，`/auth` 登录注册（见 `src/App.tsx`）。

### 对话数据流（单会话）

每个用户一条时间线，无 `chat_sessions` / `chat_messages`：

1. 前端 `insertChatMessage(userId, "user", text)` → `messages`
2. 调用 Edge：`POST /functions/v1/stream-chat`，body 含 `messages`（本轮用户句）与 `user_message_id`
3. Edge：为该 user 行补 `embedding` → RAG 拼 prompt → OpenRouter 流式 → `insert` assistant 到 `messages`
4. UI：`messages` 表 Realtime 订阅 + 流结束后的 `needsSync` 刷新

Prompt 在 Edge 内拼装（`supabase/functions/stream-chat/prompt.ts` + `rag.ts`），模板含画像、近期对话、向量检索的摘要/锚点/日记；前端**不**发送完整 prompt。

### 长期记忆（夜间加工）

Celery（后端仓库）读取同一库的 `messages`、`diaries`，写入 `summaries`、`profiles`、`anchors`；次日对话时 Edge 再检索这些表。详见后端 README。

## 数据库（`supabase/migrations/`）

| 表 | 用途 |
|----|------|
| `auth.users` | Supabase Auth 用户（业务表 `user_id` 外键指向此处） |
| `messages` | 对话唯一存储（user/assistant + `embedding`） |
| `diaries` | 日记正文 + `embedding`（RAG / Celery） |
| `profiles` | 长期画像 Markdown |
| `summaries` | 日/周/月/年摘要（Celery 写 `type=daily` 等） |
| `anchors` | 重要事件锚点 |
| `user_crypto` | 保险箱 salt/校验包（可选能力，见下） |
| `data_access_audit` | 访问审计 |

已删除（迁移 `20260211140000` 起）：`chat_sessions`、`chat_messages`、`diary_entries`。

**安全模型**：业务表启用 **RLS**，策略为 `user_id = auth.uid()`；`anon` 角色已 revoke。库内为**明文**存储（迁移 `20260208130000_plaintext_rls_and_audit.sql`），靠 RLS 做访问隔离，不是库内 E2EE。

注册时触发器 `handle_new_user_profile` 自动插入默认 `profiles` 行。

## Edge Functions

| 函数 | 目录 | 说明 |
|------|------|------|
| `stream-chat` | `supabase/functions/stream-chat/` | 对话 RAG + 流式 SSE（`data:` / `event: end`） |
| `index-diary` | `supabase/functions/index-diary/` | 单篇日记 embedding 写回 `diaries` |

Secrets（**勿写入前端 `.env`**）：

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
# 可选
supabase secrets set OPENROUTER_CHAT_MODEL=deepseek/deepseek-chat
# supabase secrets set OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
# supabase secrets set OPENROUTER_EMBEDDING_DIMENSIONS=2048
```

本地调试：

```bash
cp supabase/functions/stream-chat/.env.example supabase/functions/stream-chat/.env
# 编辑 OPENROUTER_API_KEY 后：
supabase functions serve stream-chat
```

## 本地开发

### 1. Supabase

```bash
supabase start
supabase status   # 记下 API URL、anon key、DB URL
```

应用迁移（新环境或结构变更后）：

```bash
supabase db reset    # 本地清空并全量迁移
# 或
supabase migration up
```

### 2. 前端环境变量

复制 `.env.example` → `.env`：

- `VITE_SUPABASE_URL` — 如 `http://127.0.0.1:54321`
- `VITE_SUPABASE_ANON_KEY` — **anon public** key（禁止 `service_role`）

### 3. 启动主站

```bash
npm install
npm run dev
```

默认 <http://localhost:5173>。

### 4. 可选：Celery 与管理端

见 [safebase_backend_cursor](../safebase_backend_cursor) README：配置 `DATABASE_URL` 指向同一 Supabase DB（直连端口常为 `54322`），启动 `uvicorn` 与 `celery worker -B`。

## 脚本

| 脚本 | 用途 |
|------|------|
| `scripts/migrate_legacy_to_supabase.py` | 一次性：旧 Postgres → Supabase（需 `LEGACY_DATABASE_URL` / `TARGET_DATABASE_URL`，且 `auth.users.id` 与旧用户一致） |

已移除：`simulate-chat.js`（依赖已删除的 FastAPI `/api/chat`）。

## 技术栈

- React 18、TypeScript、Vite 5
- Ant Design 5、Zustand、React Router 6、react-hook-form + zod
- `@supabase/supabase-js`（Auth、PostgREST、Realtime、Functions）

## 目录结构（要点）

```text
src/
  api/chatStream.ts      # 唯一对话 HTTP 客户端（Edge）
  lib/chatDb.ts          # messages CRUD + Realtime
  lib/diaryDb.ts         # diaries CRUD + index-diary
  lib/supabase.ts        # Supabase 客户端
  stores/authStore.ts    # Auth 会话
  stores/chatStore.ts    # 流式状态
supabase/
  migrations/            # 表、RLS、RPC、触发器
  functions/             # stream-chat, index-diary
```

## 遗留 / 未接入代码

仓库中仍有 `VaultGate`、`vaultStore`、`lib/encryption.ts`（早期 E2EE 方案），**当前路由未挂载 VaultGate**，日记与对话均走明文表 + RLS。若重新启用客户端加密，需自行接回布局并核对与 `user_crypto` 的迁移一致性。

## 构建

```bash
npm run build
npm run preview
```

## UI

- 背景 `#F5F0E8`，点缀 `#A7C7C9`
- 用户气泡 `#E3F2E8`，AI 白底轻阴影
- 大圆角、宽松留白
