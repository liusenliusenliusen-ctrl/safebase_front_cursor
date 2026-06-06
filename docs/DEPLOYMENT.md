# SafeBase 生产部署指南（自建 Supabase + 服务器）

面向已在**本地 `supabase start` 联调成功**的场景：在 **同一台 VPS** 上自建 Supabase（Docker），并部署 front / admin / backend。

| 仓库 | 服务器角色 | 产物 | 常驻进程 |
|------|------------|------|----------|
| `safebase_front_cursor` | 主站静态页 + Supabase 迁移/Edge 源码 | `dist/`、`supabase/` | 否（Nginx 托管静态页） |
| `safebase_admin_cursor` | 管理后台静态页 | `dist/` | 否 |
| `safebase_backend_cursor` | Node API + 夜间 cron | `dist/` + `package.json` | 是（PM2） |
| **Supabase（Docker）** | Auth、PostgREST、Realtime、Edge、Postgres | 官方 `docker` 栈 | 是（Docker Compose） |

相关文档：[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)（架构与本地开发）

---

## 1. 架构

```text
用户浏览器
  ├─ http://服务器IP/           → Nginx → /opt/safebase/front/dist
  ├─ http://服务器IP:8081/      → Nginx → /opt/safebase/admin/dist
  │                                  └─ /api → 127.0.0.1:8000 (backend)
  ├─ https://api.你的域名/      → Nginx → Supabase Kong（:54321 或 Docker 映射端口）
  │     Auth / PostgREST / Realtime /functions/v1/stream-chat
  └─ 主站对话与登录              → 上述 Supabase API（HTTPS）

backend (:8000)
  ├─ GET /api/admin/*
  └─ cron → dist/scripts/run-tasks.js
       └─ 直连 Postgres（127.0.0.1:54322 或 Docker 暴露端口）
```

**与本地开发一致：** 本地 `supabase start` 即同一套组件；生产只是把 Supabase 栈跑在 VPS 的 Docker 里，并配置公网访问与 Nginx 反代。

---

## 2. 服务器要求

| 项 | 建议 |
|----|------|
| 规格 | **2 vCPU + 4 GiB** 可跑通调试/少量用户；建议开 **2–4 GiB swap** |
| 系统 | Linux（Ubuntu 22.04+ / Rocky 9 等），已安装 Docker + Docker Compose v2 |
| 端口 | 80、443（Nginx）；Supabase API 经 Nginx 反代，**勿将 54322 裸奔公网** |
| 出站 | Edge 需访问 OpenRouter（`OPENROUTER_API_KEY`） |

---

## 3. 部署 Supabase（Docker）

采用 [Supabase 官方自托管 Docker](https://supabase.com/docs/guides/self-hosting/docker)。

### 3.1 获取并配置

```bash
cd /opt
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker
cp .env.example .env
```

编辑 `.env`，**至少**修改（禁止使用默认值上线）：

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `ANON_KEY` / `SERVICE_ROLE_KEY`（可用官方脚本生成）
- `SITE_URL`、`API_EXTERNAL_URL`、`SUPABASE_PUBLIC_URL`（改为你的公网 API 地址）

启动：

```bash
docker compose pull
docker compose up -d
```

验证：浏览器打开 Studio（默认映射端口见 `docker-compose.yml`，常见为 `3000`），或用 `curl` 访问 Kong 健康检查。

### 3.2 应用数据库迁移

在**开发机**（已安装 Supabase CLI）或服务器上，从 `safebase_front_cursor` 仓库：

```bash
cd safebase_front_cursor

# 将 <密码>、<主机> 换成 Docker Postgres 可达地址（同机多为 127.0.0.1:5432 或 compose 映射端口）
supabase db push --db-url "postgresql://postgres:<密码>@<主机>:5432/postgres"
```

或把 `supabase/migrations/*.sql` 按文件名顺序在 Studio SQL Editor 中执行。

### 3.3 部署 Edge Functions

```bash
cd safebase_front_cursor

# 将 CLI 指向自托管实例（具体参数以当前 Supabase CLI 文档为准）
supabase link --project-ref default   # 或自托管 link 方式
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-...
supabase secrets set OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-large
supabase secrets set OPENROUTER_EMBEDDING_DIMENSIONS=2048
supabase functions deploy stream-chat
supabase functions deploy index-diary
```

本地调试 Edge 时，密钥写在 `supabase/functions/.env`（见 `stream-chat/.env.example`），**勿提交 Git**。

### 3.4 记录生产用 URL 与 Key

构建 front 时需要：

- `VITE_SUPABASE_URL` — 浏览器访问的 Supabase API 根 URL（经 Nginx 的 `https://api.你的域名`）
- `VITE_SUPABASE_ANON_KEY` — Docker `.env` 中的 `ANON_KEY`

backend 需要：

- `DATABASE_URL` — 例如 `postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres`（仅本机访问，走 Docker 映射端口）

---

## 4. 本地打包应用

在三个仓库的父目录执行。

### 4.1 主站 front

```bash
cd safebase_front_cursor

# 生产变量（构建时打入，不可用开发 .env 代替）
export VITE_SUPABASE_URL=https://api.你的域名
export VITE_SUPABASE_ANON_KEY=你的_ANON_KEY

npm ci && npm run build
cd .. && tar czf front.tar.gz -C safebase_front_cursor dist
```

### 4.2 管理后台 admin

```bash
cd safebase_admin_cursor
npm ci && npm run build
cd .. && tar czf admin.tar.gz -C safebase_admin_cursor dist
```

admin 与 backend 同机且 Nginx 反代 `/api` 时，**不必**设置 `VITE_API_BASE_URL`。

### 4.3 后端 backend

```bash
cd safebase_backend_cursor
npm ci && npm run build
cd .. && tar czf backend.tar.gz -C safebase_backend_cursor \
  package.json package-lock.json dist prompts scripts/cron.example
```

### 4.4 上传

```bash
scp front.tar.gz admin.tar.gz backend.tar.gz user@服务器:/opt/safebase/
scp safebase_backend_cursor/.env user@服务器:/opt/safebase/backend.env
```

---

## 5. 服务器：应用与 backend

```bash
sudo mkdir -p /opt/safebase/{front,admin,backend}
cd /opt/safebase
tar xzf front.tar.gz -C front
tar xzf admin.tar.gz -C admin
tar xzf backend.tar.gz -C backend
mv backend.env backend/.env
```

### 5.1 `backend/.env` 示例

```env
DATABASE_URL=postgresql://postgres:你的POSTGRES_PASSWORD@127.0.0.1:5432/postgres
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-large
OPENROUTER_EMBEDDING_DIMENSIONS=2048
OPENROUTER_CHAT_MODEL=deepseek/deepseek-chat
ADMIN_SECRET=你的管理后台登录密钥
PORT=8000
```

- `DATABASE_URL`：与 Supabase Docker 的 Postgres 一致；backend 与 Supabase **同机**时用 `127.0.0.1` + compose 映射端口。
- `ADMIN_SECRET`：自行设定；登录 admin 页时输入相同字符串。

```bash
cd /opt/safebase/backend
npm ci --omit=dev
pm2 start dist/src/index.js --name safebase-backend
pm2 save && pm2 startup
```

验证：

```bash
curl http://127.0.0.1:8000/api/admin/users -H "X-Admin-Key: 你的ADMIN_SECRET"
```

---

## 6. Nginx

### 6.1 主站 + 管理后台（无独立 API 域名时）

```bash
cat > /etc/nginx/conf.d/safebase.conf <<'EOF'
server {
    listen 80;
    server_name _;
    root /opt/safebase/front/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}

server {
    listen 8081;
    server_name _;
    root /opt/safebase/admin/dist;
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location / { try_files $uri $uri/ /index.html; }
}
EOF
nginx -t && systemctl reload nginx
```

### 6.2 Supabase API 反代（示例）

将 `api.你的域名` 反代到 Kong（端口以 `docker-compose.yml` 为准，自托管常见为 `8000` 或映射的 API 端口）：

```nginx
server {
    listen 443 ssl;
    server_name api.你的域名;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_buffering off;   # Edge 流式需要
    }
}
```

`VITE_SUPABASE_URL` 必须与浏览器实际访问的 API 地址一致（含 `https://`）。

---

## 7. 夜间批处理（cron）

```bash
crontab -e
```

```cron
30 23 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js daily >> /var/log/safebase-daily.log 2>&1
10  0 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js profiles >> /var/log/safebase-profiles.log 2>&1
30  0 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js anchors >> /var/log/safebase-anchors.log 2>&1
```

---

## 8. 上线验证

| 检查 | 命令/操作 |
|------|-----------|
| Postgres | backend `curl` 管理 API 返回 200 |
| Edge | `curl -i "$VITE_SUPABASE_URL/functions/v1/stream-chat"` 无 token 时应 **401**（非 function not found） |
| 主站 | 浏览器注册、登录、发消息有流式回复 |
| 管理后台 | `http://IP:8081/` + `ADMIN_SECRET` |

---

## 9. 更新发布

1. 迁移变更：`supabase db push` 或 SQL 执行新 migration  
2. Edge 变更：`supabase functions deploy ...`  
3. 应用：`npm run build` → 上传 tar → 解压覆盖  
4. `pm2 restart safebase-backend`；`nginx -t && systemctl reload nginx`  

仅改前端时，重新构建并覆盖 `front/dist`（及必要时 `admin/dist`）即可。

---

## 10. 常见问题

| 现象 | 处理 |
|------|------|
| 对话 `function not found` | 确认已 `functions deploy stream-chat`，URL 为 `/functions/v1/stream-chat` |
| `OPENROUTER_API_KEY is not set` | `supabase secrets set` 后重新 deploy Edge |
| 管理后台 401 | `ADMIN_SECRET` 与登录页一致 |
| 管理后台 500 | 检查 `DATABASE_URL` 能否从本机连上 Docker Postgres |
| 主站连不上 Supabase | `VITE_SUPABASE_URL` 须为浏览器可访问的 API 地址；检查 Nginx 反代与 CORS |
| 内存不足 | 4 GiB 紧张时可加 swap、关闭 Studio 公网暴露，或升到 8 GiB |

---

## 11. 安全提醒

- 勿将 `.env`、`POSTGRES_PASSWORD`、`SERVICE_ROLE_KEY` 提交 Git  
- `anon key` 可进前端；`service_role` 与数据库密码仅服务器使用  
- 生产务必 HTTPS；Postgres 端口不要对公网开放  
