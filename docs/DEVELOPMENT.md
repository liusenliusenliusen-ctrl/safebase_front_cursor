# SafeBase 开发指南

面向幸存者的 CPTSD 陪伴产品。系统由 **三个独立 Git 仓库** 组成，共享 **同一套自建 Supabase Postgres**（本地 `supabase start` → `127.0.0.1:54322`；生产为服务器 Docker 自托管，见 [DEPLOYMENT.md](./DEPLOYMENT.md)）。

| 仓库 | 路径示例 | 职责 |
|------|----------|------|
| **safebase_front_cursor** | 本仓库 | 主站 React 前端、Supabase 迁移、Edge Functions（对话 RAG + 日记 embedding） |
| **safebase_backend_cursor** | 兄弟目录 | cron 夜间记忆批处理（摘要/画像/锚点）、HTTP 管理 API |
| **safebase_admin_cursor** | 兄弟目录 | 运营/开发只读管理后台 |

> **架构原则：** 用户侧读写走 **Supabase Auth + RLS + PostgREST/Realtime/Edge**；后端服务用 `DATABASE_URL` 直连同一库（绕过 RLS），只做批处理与管理查询。

---

## 1. 项目架构

### 1.1 整体拓扑

```mermaid
flowchart TB
  subgraph clients [客户端]
    User[用户浏览器 :5173]
    Admin[管理后台 :5174]
  end

  subgraph supabase [Supabase 本地/生产 Docker]
    Auth[GoTrue Auth]
    Kong[Kong API :54321]
    PG[(Postgres + pgvector)]
    Realtime[Realtime]
    EdgeRT[Edge Runtime]
  end

  subgraph edge [Edge Functions]
    StreamChat[stream-chat]
    IndexDiary[index-diary]
  end

  subgraph backend [safebase_backend_cursor :8000]
    AdminAPI["/api/admin/*"]
    CronTasks["run-tasks.ts (cron)"]
  end

  OpenRouter[OpenRouter API]

  User --> Auth
  User --> Kong
  Kong --> PG
  Kong --> Realtime
  Kong --> EdgeRT
  EdgeRT --> StreamChat
  EdgeRT --> IndexDiary
  StreamChat --> PG
  StreamChat --> OpenRouter
  IndexDiary --> PG
  IndexDiary --> OpenRouter

  Admin --> AdminAPI
  AdminAPI --> PG
  CronTasks --> PG
  CronTasks --> OpenRouter
```

### 1.2 各仓库技术栈

| 仓库 | 技术 | 默认端口 |
|------|------|----------|
| front | React 18, TypeScript, Vite 5, Ant Design 5, Zustand, React Router 6, `@supabase/supabase-js` | 5173 |
| backend | Node.js, TypeScript, Fastify, pg | 8000 |
| admin | React 18, Vite 5, Ant Design 5, Axios, Zustand | 5174 |

Edge Functions 运行在 **Deno**（Supabase Edge Runtime），源码在 `supabase/functions/`。

### 1.3 职责边界（重构后）

| 能力 | 由谁提供 | 说明 |
|------|----------|------|
| 注册/登录 | Supabase Auth | 用户名映射为 `{slug}@safebase.internal` |
| 对话 CRUD | 前端 + PostgREST | `messages` 表，RLS 隔离 |
| 流式对话 + RAG | Edge `stream-chat` | 拼 prompt、调 OpenRouter、写 assistant 消息 |
| 日记 CRUD | 前端 + PostgREST | `diaries` 表 |
| 日记向量索引 | Edge `index-diary` | 保存后异步写 `diaries.embedding` |
| 日摘要 / 画像 / 锚点 | cron + `run-tasks.ts`（backend） | 读 `messages`/`diaries`，写 `summaries`/`profiles`/`anchors` |
| 用户列表与统计 | Node admin API + admin 前端 | 查 `auth.users` + 业务表计数 |

**已废弃、勿再依赖：** FastAPI 的 `/api/auth`、`/api/chat`、`/api/messages`、`/api/diary`；表 `chat_sessions`、`chat_messages`、`diary_entries`、`public.users`。

---

## 2. 数据流

### 2.1 用户注册

```text
AuthPage.signUp(username, password)
  → usernameToAuthEmail → Supabase Auth signUp
  → auth.users INSERT
  → 触发器 handle_new_user_profile()
  → profiles INSERT（默认 Markdown 占位内容）
```

相关迁移：`20260211130000_auth_profile_trigger_memory_messages_rpc.sql`

### 2.2 发送一条对话（核心路径）

```mermaid
sequenceDiagram
  participant UI as ChatPage
  participant DB as chatDb / Postgres
  participant RT as Realtime
  participant Edge as stream-chat
  participant OR as OpenRouter

  UI->>DB: insertChatMessage(user, content)
  DB-->>UI: user_message_id
  UI->>Edge: POST /functions/v1/stream-chat<br/>{messages, user_message_id}
  Edge->>Edge: JWT 校验 auth.getUser()
  Edge->>DB: ensureDefaultProfile
  Edge->>OR: embeddings(user_message) → 2048 维向量
  Edge->>DB: UPDATE messages SET embedding
  Edge->>DB: RAG RPC（近期对话 + 向量检索摘要/锚点/日记）
  Edge->>Edge: renderChatPrompt
  Edge->>OR: chat/completions (stream)
  loop SSE chunks
    Edge-->>UI: data: token
  end
  Edge->>DB: INSERT assistant message + embedding
  Edge-->>UI: event: end
  DB-->>RT: INSERT 事件
  RT-->>UI: 合并 assistant 消息到列表
```

**前端关键文件：**

- `src/pages/ChatPage.tsx` — 分页加载、Realtime 订阅、发送/停止
- `src/stores/chatStore.ts` — 流式 ticker、错误处理
- `src/api/chatStream.ts` — 调用 Edge，解析 `data:` / `event: end`
- `src/lib/chatDb.ts` — `messages` 的 insert/select/delete/subscribe

**Edge 关键文件：**

- `supabase/functions/stream-chat/index.ts` — 入口与 SSE
- `rag.ts` — `buildMemoryPrompt`、向量检索 RPC
- `memory.ts` — embedding 写入、assistant 持久化
- `prompt.ts` — 对话 prompt 模板（与 backend 旧 `chat.txt` 对齐）
- `openrouter.ts` — OpenRouter embedding 封装

**设计要点：**

- 用户消息由**前端先写入** `messages`，Edge 只补 `embedding` 并生成回复。
- 前端**不发送完整 prompt**；RAG 上下文在 Edge 内拼装。
- 流式展示用本地 ticker；最终 assistant 行以 Realtime INSERT 或 `needsSync` 拉取为准。

### 2.3 停止生成

```text
用户点停止
  → chatStore.stopMessage 取消 fetch
  → chatDb.deleteLastUserMessage 删除刚插入的 user 行
  → UI 恢复 draft
```

### 2.4 日记保存与向量索引

```text
DiaryPage 创建/更新
  → diaryDb.createDiary / updateDiary → diaries INSERT/UPDATE
  → scheduleDiaryEmbeddingIndex
  → supabase.functions.invoke("index-diary", { diary_id })
  → Edge: 读 title+content → OpenRouter embedding → UPDATE diaries.embedding
```

日记 embedding 失败**不阻塞**保存（fire-and-forget）。

### 2.5 夜间记忆（cron 批处理）

```text
cron → scripts/run-tasks.ts
  → generate_daily_summaries
      读：昨日 messages + 昨日更新的 diaries
      写：summaries(type=daily) + embedding
  → update_profiles
      读：近 7 条日摘要 + 近 50 messages + 近 5 diaries
      写：profiles.content（Markdown 画像）
  → maintain_anchors
      读/写：anchors（更新 current_thought 或新增锚点）+ embedding
```

建议 crontab（示例见 backend `scripts/cron.example`）：

| 任务 | 建议时间 | 命令 |
|------|----------|------|
| 日摘要 | 23:30 | `node dist/scripts/run-tasks.js daily` |
| 画像更新 | 00:10 | `node dist/scripts/run-tasks.js profiles` |
| 锚点维护 | 00:30 | `node dist/scripts/run-tasks.js anchors` |

**活跃用户数** = `profiles.user_id` ∪ `messages.user_id` 的去重并集。

### 2.6 管理后台查询

```text
Admin 登录页输入 ADMIN_SECRET
  → localStorage + Zustand 存 adminKey
  → GET /api/admin/users（Header: X-Admin-Key）
  → admin/routes 查 auth.users + 子查询统计
  → 详情页 GET /api/admin/users/{id}?messages_limit=50
```

Vite 将 `/api` 代理到 `http://127.0.0.1:8000`（admin 仓库 `vite.config.ts`）。

---

## 3. 数据库模型

Schema 由 **本仓库** `supabase/migrations/` 定义与演进；backend/admin **不**维护迁移。

### 3.1 核心表

| 表 | 用途 | 关键字段 |
|----|------|----------|
| `auth.users` | Supabase 认证用户 | `id`, `email`, `raw_user_meta_data` |
| `messages` | 单会话对话（user/assistant） | `content`, `embedding vector(2048)`, `role` |
| `diaries` | 日记 | `title`, `content`, `embedding vector(2048)` |
| `profiles` | 长期用户画像 | `content`（Markdown） |
| `summaries` | 日/周/月/年摘要 | `type`, `summary_date`, `content`, `embedding` |
| `anchors` | 重要事件锚点 | `event_name`, `initial/current_thought`, `evolution_history`, `embedding` |
| `data_access_audit` | 访问审计 | DML 触发器 + 前端 SELECT 审计 RPC |

### 3.2 向量与 RAG RPC

- 所有 embedding 列为 **`vector(2048)`**（pgvector + HNSW 索引）。
- Edge `stream-chat` 使用的 RPC：
  - `get_recent_memory_messages(msg_limit)` — 近期对话
  - `match_summaries_daily(query_embedding, match_count)` — 日摘要相似检索
  - `match_anchors(...)` — 锚点检索
  - `match_diaries(...)` — 日记检索

### 3.3 安全模型

- **RLS：** 业务表策略为 `user_id = auth.uid()`；`anon` 角色已 revoke。
- **存储：** 库内**明文**（早期 E2EE 已移除）；靠 RLS 做租户隔离，**不是**库内端到端加密。
- **审计：**
  - DML：`private.audit_row_dml()` 触发器
  - SELECT：前端经 `audit_read_access` RPC（`src/lib/auditLog.ts`）
- **销户：** RPC `delete_my_data()` 清除该用户业务数据与审计行。

### 3.4 迁移时间线（摘要）

| 迁移文件 | 要点 |
|----------|------|
| `20260208130000_plaintext_rls_and_audit` | 明文 + RLS + 审计 |
| `20260209100000_profiles_summaries_anchors` | 记忆三表 + pgvector |
| `20260210120000_legacy_messages_diary_entries_rag` | `messages`、旧 `diary_entries` |
| `20260211120000_diaries_embedding_rag_rpc` | 日记 embedding + 向量 RPC |
| `20260211130000_auth_profile_trigger_memory_messages_rpc` | 注册触发器 + 记忆 RPC |
| `20260211140000_unify_messages_drop_chat_tables` | 统一到 `messages`，Realtime |
| `20260211150000_drop_legacy_diary_entries` | 删除 `diary_entries` |
| `20260220120000_fix_audit_row_dml_on_signup` | 修复注册时 audit 触发器 bug |

---

## 4. Edge Functions 参考

### 4.1 `stream-chat`

| 项 | 说明 |
|----|------|
| 路径 | `POST /functions/v1/stream-chat` |
| 鉴权 | `Authorization: Bearer <user JWT>` + `apikey: <anon key>` |
| 请求体 | `{ "messages": [{role, content}], "user_message_id": number }` |
| 响应 | SSE：`data: <文本块>\n\n`，结束 `event: end\n\n` |
| Secrets | `OPENROUTER_API_KEY`（必填）；模型/维度见下节 |

### 4.2 `index-diary`

| 项 | 说明 |
|----|------|
| 路径 | `POST /functions/v1/index-diary` |
| 请求体 | `{ "diary_id": number }` |
| 响应 | `{ "ok": true, "diary_id": ... }` |

---

## 5. 环境变量

### 5.1 前端（`.env`）

| 变量 | 必填 | 说明 |
|------|------|------|
| `VITE_SUPABASE_URL` | 是 | 如 `http://127.0.0.1:54321` |
| `VITE_SUPABASE_ANON_KEY` | 是 | Dashboard anon public key，**禁止** service_role |

### 5.2 Edge Functions（`supabase/functions/.env`，勿提交 Git）

| 变量 | 必填 | 说明 |
|------|------|------|
| `OPENROUTER_API_KEY` | 是 | 以 `sk-or-v1-` 开头 |
| `OPENROUTER_CHAT_MODEL` | 否 | 默认 `deepseek/deepseek-chat` |
| `OPENROUTER_EMBEDDING_MODEL` | 否 | 默认 `openai/text-embedding-3-large` |
| `OPENROUTER_EMBEDDING_DIMENSIONS` | 否 | 默认 `2048`（与 DB 一致） |

> **重要：** DB 为 `vector(2048)` 时，embedding 模型须支持 2048 维。`text-embedding-3-small` 最高 **1536**，会报错；请用 **`text-embedding-3-large`** + `dimensions=2048`。

**加载时机：** 仅在 `supabase start` **启动时**注入容器；修改 `.env` 后需：

```bash
supabase stop && supabase start
```

远程部署用 `supabase secrets set OPENROUTER_API_KEY=...`，不要用前端 `.env`。

### 5.3 后端（`safebase_backend_cursor/.env`）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| `OPENROUTER_API_KEY` | 跑批处理时 | 夜间任务 LLM/embedding |
| `OPENROUTER_EMBEDDING_MODEL` | 建议 | 与 front 一致用 `openai/text-embedding-3-large` |
| `OPENROUTER_EMBEDDING_DIMENSIONS` | 建议 | `2048` |
| `ADMIN_SECRET` | 管理端 | 与 admin 登录密钥一致 |

### 5.4 管理前端（`safebase_admin_cursor/.env`，可选）

| 变量 | 说明 |
|------|------|
| `VITE_API_BASE_URL` | 留空则走 Vite 代理 `/api` → `:8000` |

---

## 6. 本地全栈启动

按顺序在三个终端执行：

### 6.1 数据库 + Edge（front 仓库）

```bash
cd safebase_front_cursor
supabase start
supabase db reset          # 新环境或迁移变更后
cp .env.example .env       # 填写 VITE_SUPABASE_*
# 编辑 supabase/functions/.env → OPENROUTER_API_KEY 等
supabase stop && supabase start   # 若刚改过 functions/.env
npm install && npm run dev        # http://localhost:5173
```

`supabase status` 可查看 API URL、anon key、DB URL。

### 6.2 后端 API + 批处理（可选）

```bash
cd safebase_backend_cursor
cp .env.example .env
npm install
npm run dev            # 或 npm run build && npm start

# 手动跑夜间任务
npm run tasks -- daily
npm run tasks -- profiles anchors
```

生产环境用 crontab 定时调用 `run-tasks.js`，见 backend 仓库 `scripts/cron.example`。

### 6.3 管理后台（可选）

```bash
cd safebase_admin_cursor
npm install && npm run dev   # http://localhost:5174
```

登录密钥 = backend `.env` 的 `ADMIN_SECRET`。

### 6.4 端口一览

| 服务 | 端口 |
|------|------|
| Supabase API / Functions | 54321 |
| Postgres | 54322 |
| Studio | 54323 |
| 主站 Vite | 5173 |
| 管理 Vite | 5174 |
| Node backend (Fastify) | 8000 |

（无 Redis — 批处理由系统 cron 触发）

---

## 7. 目录结构速查

### 7.1 safebase_front_cursor

```text
src/
  pages/          AuthPage, ChatPage, DiaryPage
  stores/         authStore, chatStore
  lib/            supabase, chatDb, diaryDb, auditLog, authEmail
  api/            chatStream.ts（唯一对外 HTTP 封装）
supabase/
  migrations/     数据库演进（唯一真相源）
  functions/
    stream-chat/  对话 Edge（index, rag, memory, prompt, openrouter）
    index-diary/  日记 embedding
scripts/
  migrate_legacy_to_supabase.py
```

### 7.2 safebase_backend_cursor

```text
src/
  index.ts          Fastify 入口
  admin/routes.ts   管理 API
  tasks/index.ts    夜间批处理
  llm/openrouter.ts
  prompts/index.ts
scripts/
  run-tasks.ts
  cron.example
```

### 7.3 safebase_admin_cursor

```text
src/
  pages/       LoginPage, UserListPage, UserDetailPage
  api/         admin.ts, client.ts（X-Admin-Key）
  stores/      adminStore.ts
```

---

## 8. Prompt 与 LLM 分工

| 场景 | Prompt 位置 | 模型调用 |
|------|-------------|----------|
| 用户实时对话 | `supabase/functions/stream-chat/prompt.ts` | Edge → OpenRouter chat + embedding |
| 日摘要 | `backend/prompts/daily_summary.txt` | `run-tasks.ts` → OpenRouter |
| 画像更新 | `backend/prompts/profile_update.txt` | `run-tasks.ts` |
| 锚点提取/更新 | `backend/prompts/anchor_*.txt` | `run-tasks.ts` |

Backend 通过 `src/prompts/index.ts` 加载模板：内嵌默认 + 可选文件覆盖（`PROMPT_TEMPLATE_DIR`）。

---

## 9. 部署要点

生产环境采用 **服务器自建 Supabase（Docker）**，与本地 `supabase start` 使用同一套迁移与 Edge 源码。完整步骤见 **[DEPLOYMENT.md](./DEPLOYMENT.md)**。

摘要：

1. Docker 启动 Supabase → `supabase db push` 应用迁移  
2. `supabase functions deploy stream-chat index-diary` + `supabase secrets set`  
3. 构建 front/admin 静态资源 + PM2 跑 backend  
4. Nginx 托管静态页并反代 Supabase API、`/api/admin`  

### 9.1 后端批处理

- 在能访问 `DATABASE_URL` 的机器上配置 **crontab** 调用 `dist/scripts/run-tasks.js`（见 `scripts/cron.example`）。
- 可与 Node API 同机；**无需 Redis**。

### 9.2 管理后台

- 构建时设置 `VITE_API_BASE_URL` 指向生产 backend，或由 Nginx 统一转发 `/api`。

---

## 10. 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| `OPENROUTER_API_KEY is not set` | Edge 容器未加载 `.env` | 确认 `supabase/functions/.env`，然后 `supabase stop && supabase start` |
| `Missing Authentication header` | Key  typo（如 `ssk-or-v1-`）或无效 | 从 OpenRouter 重新复制，前缀应为 `sk-or-v1-` |
| `embeddings returned empty vector` | `small` 模型 + 2048 维不兼容 | 改用 `openai/text-embedding-3-large` + `OPENROUTER_EMBEDDING_DIMENSIONS=2048` |
| 对话 401 | JWT 过期或未登录 | 重新登录；检查前端 anon key |
| 管理后台用户列表空 | DB 不一致或未注册用户 | 确认 `DATABASE_URL` 与主站同一库；主站需有 Supabase Auth 用户 |
| 修改 functions/.env 不生效 | 仅 `start` 时注入 | 必须重启 Supabase，不能热更新 |
| `supabase functions serve` vs `start` | 前者用于函数热重载调试 | 日常全栈开发用 `supabase start` 即可 |

---

## 11. 遗留与未接线代码

以下来自早期 E2EE 方案，**当前路由未使用**，可忽略或后续清理：

- `src/lib/encryption.ts`
- `src/stores/vaultStore.ts`
- `src/components/VaultGate.tsx`、`VaultUnlockModal.tsx`

`delete_my_data()` 中若仍引用已删除的 `user_crypto` 表，在无该表时为无害 no-op。

---

## 12. 相关文档

- 主站 README：`../README.md`
- 后端 README：`../../safebase_backend_cursor/README.md`
- 管理后台 README：`../../safebase_admin_cursor/README.md`
- Supabase 本地开发：https://supabase.com/docs/guides/cli/local-development
- Edge Functions Secrets：https://supabase.com/docs/guides/functions/secrets

---

*文档版本与仓库 commit 同步维护；Schema 以 `supabase/migrations/` 为准。*
