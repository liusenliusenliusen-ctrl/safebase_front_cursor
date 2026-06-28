# SafeBase 开发指南

CPTSD 陪伴产品，由 **三个独立 Git 仓库** 组成，共享同一套 **Postgres + pgvector**（无 Supabase）。

| 仓库 | 角色 |
|------|------|
| **safebase_front_cursor** | 主站 React 前端 |
| **safebase_backend_cursor** | Fastify API、对话 RAG、夜间批处理、数据库 Schema |
| **safebase_admin_cursor** | 管理后台（只读展示） |

## 架构

```text
┌─────────────────────────────────────────────────────────────┐
│  浏览器                                                      │
│  主站 :5173  │  管理后台 :5174                               │
└──────┬───────────────┬──────────────────────────────────────┘
       │ /api (proxy)  │ /api (proxy)
       ▼               ▼
┌──────────────────────────────────────────────────────────────┐
│  safebase_backend_cursor  Fastify :8000                      │
│  ├─ /api/auth/*        JWT + bcrypt                          │
│  ├─ /api/messages      对话消息                              │
│  ├─ /api/chat/stream   RAG + OpenRouter SSE                  │
│  ├─ /api/diaries       日记 + embedding                      │
│  ├─ /api/account       注销（删用户及数据）                  │
│  ├─ /api/admin/*      管理 API（X-Admin-Key）                │
│  └─ scripts/run-tasks  夜间批处理（cron）                    │
└──────────────────────────┬───────────────────────────────────┘
                           │ DATABASE_URL
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Postgres 16 + pgvector  (宿主机 :5433 → 容器 :5432)         │
│  docker compose（backend 仓库，容器名 safebase-postgres）    │
│  Schema: sql/migrations/001_initial.sql                      │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    OpenRouter（chat + embedding）
```

**鉴权：** 用户侧用 JWT（`Authorization: Bearer`）；无 RLS，权限在 Fastify 中间件校验 `user_id`。

## 技术栈

| 组件 | 栈 | 默认端口 |
|------|-----|----------|
| front | React 18, Vite 5, Ant Design, Zustand | 5173 |
| admin | React 18, Vite 5, Ant Design, Axios | 5174 |
| backend | Node 18+, Fastify, pg, jose, bcryptjs | 8000 |
| DB | pgvector/pgvector:pg16（Docker） | 5433（宿主机） |

## 数据流

### 注册

```text
POST /api/auth/register { username, password }
  → INSERT public.users + profiles
  → 返回 JWT + user
```

### 发消息

```text
POST /api/messages { role: "user", content }
  → INSERT messages
POST /api/chat/stream { messages, user_message_id }
  → embedding + RAG 拼 prompt
  → OpenRouter 流式 SSE（data: / event: end）
  → INSERT assistant message
前端流结束后 needsSync → 重新拉 messages
```

### 日记

```text
POST /api/diaries → 后端异步写 embedding
PATCH /api/diaries/:id → 同上
```

### 夜间记忆

```text
cron → npm run tasks -- daily | profiles | anchors
  → 读 messages/diaries
  → 写 summaries / profiles / anchors（含 embedding）
```

## 数据库

Schema 由 **backend** `sql/migrations/` 维护；`docker compose up` 首次启动自动执行。

| 表 | 说明 |
|----|------|
| `public.users` | 用户（username、email、password_hash） |
| `messages` | 对话（user/assistant + embedding） |
| `diaries` | 日记 + embedding |
| `profiles` | 长期画像 Markdown |
| `summaries` | 日/周/月/年摘要 |
| `anchors` | 重要事件锚点 |
| `data_access_audit` | 写操作审计（SELECT 暂未接前端） |

向量维度默认 **2048**（`openai/text-embedding-3-large`）。

## 环境变量

### 前端（`safebase_front_cursor/.env`）

| 变量 | 必填 | 说明 |
|------|------|------|
| `VITE_API_BASE_URL` | 否 | 留空 → dev 走 Vite `/api` 代理到 :8000 |

### 后端（`safebase_backend_cursor/.env`）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | `postgresql://postgres:postgres@127.0.0.1:5433/safebase`（Docker 映射 5433，避免与本机 Postgres 冲突） |
| `JWT_SECRET` | 是 | JWT 签名，生产用随机长串 |
| `OPENROUTER_API_KEY` | 对话/embedding 必填 | OpenRouter 密钥 |
| `ADMIN_SECRET` | 管理端必填 | 与 admin 登录页一致 |
| `PORT` | 否 | 默认 8000 |

### 管理后台（`safebase_admin_cursor/.env`）

| 变量 | 必填 | 说明 |
|------|------|------|
| `VITE_API_BASE_URL` | 否 | 留空 → Vite 代理 `/api` |

## 本地联调（推荐顺序）

```bash
# 1. 数据库
cd safebase_backend_cursor
docker compose up -d

# 2. 后端
cp .env.example .env   # 填写 OPENROUTER_API_KEY、JWT_SECRET、ADMIN_SECRET
npm install && npm run dev

# 3. 主站
cd ../safebase_front_cursor
npm install && npm run dev    # :5173

# 4. 管理后台（可选）
cd ../safebase_admin_cursor
npm install && npm run dev    # :5174
```

验证：

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/admin/users -H "X-Admin-Key: 你的ADMIN_SECRET"
```

连接数据库（Postgres 在 Docker 内）：

```bash
# 本机 psql
psql "postgresql://postgres:postgres@127.0.0.1:5433/safebase"

# 或进入容器
docker exec -it safebase-postgres psql -U postgres -d safebase
```

## 目录结构（要点）

```text
safebase_front_cursor/
  src/api/          client.ts, chatStream.ts
  src/lib/          chatDb.ts, diaryDb.ts
  docs/             本文件、DEPLOYMENT.md

safebase_backend_cursor/
  sql/migrations/   数据库 Schema（唯一来源）
  src/auth/         JWT、注册登录
  src/chat/         RAG、SSE
  src/messages/     消息 API
  src/diaries/      日记 API
  src/admin/        管理 API
  src/tasks/        夜间批处理
  prompts/          LLM 模板
  docker-compose.yml

safebase_admin_cursor/
  src/api/          admin.ts, client.ts
  src/pages/        登录、用户列表、详情
```

## Prompt 与 RAG

| 场景 | 模板位置 |
|------|----------|
| 用户实时对话 | `src/chat/prompt.ts` + `src/chat/memory.ts` |
| 日摘要 | `prompts/daily_summary.txt` |
| 画像更新 | `prompts/profile_update.txt` |
| 锚点 | `prompts/anchor_extract.txt` 等 |

## 生产部署

见 **[DEPLOYMENT.md](./DEPLOYMENT.md)**。

## 常见问题

| 现象 | 处理 |
|------|------|
| 对话无流式回复 | 检查后端 `OPENROUTER_API_KEY`；看 backend 日志 |
| 401 未登录 | Token 过期（7 天）或 localStorage 无 token，重新登录 |
| 管理后台用户列表空 | 主站先注册用户；确认 `DATABASE_URL` 同一库 |
| 注册 500 / `role "postgres" does not exist` | Mac 本机 Postgres 占用了 5432；用 Docker 映射 **5433**（见 `docker-compose.yml`），`.env` 里 `DATABASE_URL` 改为 `:5433` |
| 后端 `EADDRINUSE :8000` | 已有旧进程占用端口：`lsof -ti :8000 \| xargs kill -9`，再 `npm run dev` |
| 后端 `Cannot find package 'bcryptjs'` | 在 backend 仓库执行 `npm install`（依赖含 bcryptjs、jose） |
| 迁移不生效 | 删 volume 重建：`docker compose down -v && docker compose up -d`（会清空数据） |
| CORS | 后端已 `cors: origin: true`；生产用 Nginx 同源反代 `/api` 更佳 |

---

*Schema 以 `safebase_backend_cursor/sql/migrations/` 为准。*
