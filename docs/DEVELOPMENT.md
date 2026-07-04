# SafeBase 开发指南

创伤疗愈伴侣产品，由 **三个独立 Git 仓库** 组成，共享同一套 **Postgres + pgvector**（无 Supabase）。服务**有创伤经历、正在自我疗愈**的群体，定位宽于 CPTSD 诊断标签。

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
│  docker compose（backend 仓库，容器名 trauma-heal-postgres）    │
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

**库名 `trauma_heal`**（原 `safebase`）。若本地已有旧容器 `safebase-postgres` 与旧库：

```bash
# 方案 A：保留数据 — 停旧容器后按 sql/migrations/002_rename_database_*.sql 执行 ALTER DATABASE
# 方案 B：开发重建 — docker compose down && docker rm safebase-postgres 2>/dev/null; docker compose up -d
# 同步 backend .env 中 DATABASE_URL 为 .../trauma_heal
```

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
| `DATABASE_URL` | 是 | `postgresql://postgres:postgres@127.0.0.1:5433/trauma_heal`（Docker 映射 5433，避免与本机 Postgres 冲突） |
| `JWT_SECRET` | 是 | JWT 签名；**必填**，缺失时注册/登录返回 500 |
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
psql "postgresql://postgres:postgres@127.0.0.1:5433/trauma_heal"

# 或进入容器
docker exec -it trauma-heal-postgres psql -U postgres -d trauma_heal
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

## 数据访问与隐私演进

用户敏感数据的访问控制分阶段计划（明文库 + 严格 DB 权限 + 管理端不看正文 → 可选客户端加密）见 **[SECURITY_EVOLUTION.md](./SECURITY_EVOLUTION.md)**。Prompt 调试期可不实施，上线前建议至少完成阶段 1–2 检查清单。

## E2E 自动化（Playwright）

浏览器端到端测试，覆盖注册、对话、写日记。**本地**运行，默认 `http://localhost:5173`（Vite 代理 `/api` → 后端）。

### 前置（须先启动）

```bash
# 终端 1：数据库 + 后端（含 JWT_SECRET、OPENROUTER_API_KEY）
cd safebase_backend_cursor
docker compose up -d
npm run dev

# 终端 2：E2E（会自动起前端 dev，或复用已有 :5173）
cd safebase_front_cursor
npm install
npx playwright install chromium   # 首次
npm run test:e2e
```

| 命令 | 说明 |
|------|------|
| `npm run test:e2e` | 无头运行全部 E2E |
| `npm run test:e2e:headed` | 有界面，便于调试 |
| `npm run test:e2e:ui` | Playwright UI 模式 |
| `npm run test:e2e:report` | 查看上次 HTML 报告 |

用例位于 `e2e/`：`auth.spec.ts`（注册/登录）、`chat.spec.ts`（发消息 + 助手回复，需 OpenRouter）、`diary.spec.ts`（写日记）。

环境变量（可选）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `E2E_BASE_URL` | `http://localhost:5173` | 主站地址 |
| `E2E_BACKEND_URL` | `http://127.0.0.1:8000` | global-setup 健康检查 |

## 常见问题

| 现象 | 处理 |
|------|------|
| 对话无流式回复 | 检查后端 `OPENROUTER_API_KEY`；看 backend 日志 |
| 401 未登录 | Token 过期（7 天）或 localStorage 无 token，重新登录 |
| 管理后台用户列表空 | 主站先注册用户；确认 `DATABASE_URL` 同一库 |
| 注册 500 / `role "postgres" does not exist` | Mac 本机 Postgres 占用了 5432；用 Docker 映射 **5433**（见 `docker-compose.yml`），`.env` 里 `DATABASE_URL` 改为 `:5433` |
| 注册 500 / `JWT_SECRET is not configured` | 生产 PM2 启动时 `.env` 须在 backend 根目录（与 `package.json` 同级）；见 [DEPLOYMENT.md](./DEPLOYMENT.md) |
| 后端 `EADDRINUSE :8000` | 已有旧进程占用端口：`lsof -ti :8000 \| xargs kill -9`，再 `npm run dev` |
| 后端 `Cannot find package 'bcryptjs'` | 在 backend 仓库执行 `npm install`（依赖含 bcryptjs、jose） |
| 迁移不生效 | 删 volume 重建：`docker compose down -v && docker compose up -d`（会清空数据） |
| CORS | 后端已 `cors: origin: true`；生产用 Nginx 同源反代 `/api` 更佳 |

调试对话 prompt：后端 `npm run dev` 终端在每次 `/api/chat/stream` 时打印 `chat stream: model and prompt`（含完整 prompt）；生产用 `pm2 logs safebase-backend`。

---

*Schema 以 `safebase_backend_cursor/sql/migrations/` 为准。*
