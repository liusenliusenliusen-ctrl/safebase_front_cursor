# SafeBase 生产部署指南

在 **同一台 VPS** 上部署：Postgres（Docker）+ Node API（PM2）+ Nginx 静态页。

| 仓库 | 服务器角色 | 产物 | 常驻进程 |
|------|------------|------|----------|
| `safebase_backend_cursor` | API + cron + 数据库 | `dist/`、`sql/`、`docker-compose.yml` | Docker（DB）+ PM2（API） |
| `safebase_front_cursor` | 主站静态页 | `dist/` | 否（Nginx） |
| `safebase_admin_cursor` | 管理后台静态页 | `dist/` | 否（Nginx） |

相关：[DEVELOPMENT.md](./DEVELOPMENT.md)

## 1. 架构

```text
用户浏览器
  ├─ http://服务器IP/           → Nginx → /opt/safebase/front
  │     /api/*                  → proxy → 127.0.0.1:8000（backend）
  ├─ http://服务器IP:8081/      → Nginx → /opt/safebase/admin
  │     /api/*                  → proxy → 127.0.0.1:8000
  └─ 对话流式 SSE               → 同上 /api/chat/stream（proxy_buffering off）

backend (:8000)
  ├─ 全部 /api/*
  └─ cron → node dist/scripts/run-tasks.js

Postgres (宿主机 :5433 → 容器 :5432，仅本机)
  docker compose（backend 目录，容器 trauma-heal-postgres）
```

推荐主站与 API **同源**：Nginx 反代 `/api`，前端构建时 **不必** 设置 `VITE_API_BASE_URL`。

## 2. 服务器要求

| 项 | 建议 |
|----|------|
| 规格 | 2 vCPU + 4 GiB 可跑通；建议 2–4 GiB swap |
| 系统 | Linux，Docker Compose v2、Node 18+、Nginx、PM2 |
| 端口 | 80/443（Nginx）；**5433/5432 勿对公网开放**（仅本机连 DB） |
| 出站 | OpenRouter API |

## 3. 部署数据库

在服务器 backend 目录（含 `docker-compose.yml` 与 `sql/`）：

```bash
cd /opt/safebase/backend
docker compose up -d
docker compose ps              # 确认 healthy
```

默认连接串（仅本机，与 `docker-compose.yml` 端口映射一致）：

```text
postgresql://postgres:postgres@127.0.0.1:5433/trauma_heal
```

若生产机无本机 Postgres 占用 5432，可将 `docker-compose.yml` 改为 `"5432:5432"` 并同步 `.env` 中的 `DATABASE_URL`。

**生产务必修改** `docker-compose.yml` 中的 `POSTGRES_PASSWORD`，并同步 `backend/.env` 的 `DATABASE_URL`。

新 migration：将 SQL 文件放入 `sql/migrations/`，对已存在库需手动执行（或重建 volume）。

## 4. 配置后端

`.env` 放在 **`/opt/safebase/backend/.env`**（与 `package.json` 同级，**不要**提交 Git）。PM2 启动 `dist/src/index.js` 时会自动读取该文件。

`/opt/safebase/backend/.env` 示例：

```env
DATABASE_URL=postgresql://postgres:你的密码@127.0.0.1:5433/trauma_heal
JWT_SECRET=随机长字符串至少32字符
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-large
OPENROUTER_EMBEDDING_DIMENSIONS=2048
OPENROUTER_CHAT_MODEL=deepseek/deepseek-chat
ADMIN_SECRET=你的管理后台密钥
PORT=8000
HOST=0.0.0.0
```

```bash
cd /opt/safebase/backend
npm ci --omit=dev
pm2 start dist/src/index.js --name safebase-backend
pm2 save && pm2 startup
```

验证：

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/admin/users -H "X-Admin-Key: 你的ADMIN_SECRET"

# 注册接口（应返回 token，而非 500）
curl -X POST http://127.0.0.1:8000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"testuser","password":"testpass123"}'
```

排错：`pm2 logs safebase-backend --lines 50`

## 5. 构建与上传应用

**服务器无法稳定访问 GitHub 时**，在本地 Mac build 后 `scp` 上传即可（无需在服务器 clone）。

### 5.0 一键部署（推荐，需本机 SSH 密钥已配置）

三个仓库的父目录下，在 **safebase_front_cursor** 执行：

```bash
# 可选：export DEPLOY_SERVER=root@你的服务器IP
bash scripts/deploy-upload.sh
```

脚本会：build 三端 → `COPYFILE_DISABLE=1` 打包（避免 Linux 解压 xattr 警告）→ `scp` → 远程执行 `scripts/deploy-server.sh`。

**首次部署**须先把 `.env` 放到服务器（部署包不含密钥）：

```bash
scp safebase_backend_cursor/.env root@你的服务器IP:/opt/safebase/backend/.env
ssh root@你的服务器IP 'chmod 600 /opt/safebase/backend/.env'
```

之后每次部署，`deploy-server.sh` 会**自动备份并恢复**已有 `/opt/safebase/backend/.env`；若缺失则报错退出。

仅更新 `.env` 时：

```bash
scp safebase_backend_cursor/.env root@你的服务器IP:/opt/safebase/backend/.env
ssh root@你的服务器IP 'pm2 restart safebase-backend --update-env'
```

### 5.1 手动分步（与脚本等价）

#### 主站

```bash
cd safebase_front_cursor
npm ci && npm run build
COPYFILE_DISABLE=1 tar czf /tmp/front.tar.gz -C dist .
```

#### 管理后台

```bash
cd safebase_admin_cursor
npm ci && npm run build
COPYFILE_DISABLE=1 tar czf /tmp/admin.tar.gz -C dist .
```

#### 后端

```bash
cd safebase_backend_cursor
npm ci && npm run build
COPYFILE_DISABLE=1 tar czf /tmp/backend.tar.gz \
  package.json package-lock.json dist prompts sql docker-compose.yml scripts/cron.example
```

#### 上传并在服务器部署

```bash
SERVER=root@你的服务器IP

scp /tmp/front.tar.gz /tmp/admin.tar.gz /tmp/backend.tar.gz \
  safebase_front_cursor/scripts/deploy-server.sh \
  $SERVER:/tmp/

ssh $SERVER 'chmod +x /tmp/deploy-server.sh && bash /tmp/deploy-server.sh'
```

`deploy-server.sh` 会解压到 `/opt/safebase/{front,admin,backend}`、启动 Docker、`npm ci`、`pm2 restart`、检查 health 并重载 Nginx。

## 6. Nginx

```bash
cat > /etc/nginx/conf.d/safebase.conf <<'EOF'
server {
    listen 80;
    server_name _;
    root /opt/safebase/front;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 8081;
    server_name _;
    root /opt/safebase/admin;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
nginx -t && systemctl reload nginx
```

HTTPS：在上述 `server` 块上配置 `listen 443 ssl` 与证书（certbot 等）。

## 7. 夜间批处理（cron）

```bash
crontab -e
```

```cron
30 23 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js daily >> /var/log/safebase-daily.log 2>&1
10  0 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js profiles >> /var/log/safebase-profiles.log 2>&1
30  0 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js anchors >> /var/log/safebase-anchors.log 2>&1
```

## 8. 上线验证

| 检查 | 操作 |
|------|------|
| Postgres | `cd /opt/safebase/backend && docker compose ps` healthy |
| API | `curl http://127.0.0.1:8000/api/health` → `{"ok":true}` |
| 注册 | `curl -X POST .../api/auth/register` 返回 `token` |
| 主站 | 浏览器注册、登录、发消息有流式回复 |
| 管理后台 | `http://IP:8081/` + `ADMIN_SECRET` 能看到用户 |
| 日志 | `pm2 logs safebase-backend`；Nginx：`/var/log/nginx/error.log` |

## 9. 更新发布

1. Schema 变更：执行新 SQL 或重建 DB volume（会丢数据）
2. 后端：本地 `npm run build` → 上传 backend.tar.gz → `npm ci --omit=dev` → `pm2 restart safebase-backend`
3. 前端：重新 build → 上传并覆盖 `front/`、`admin/` 目录内容
4. `nginx -t && systemctl reload nginx`

## 10. 常见问题

| 现象 | 处理 |
|------|------|
| 对话无回复 / 502 | 检查 `OPENROUTER_API_KEY`；`pm2 logs safebase-backend` |
| 流式中断 | Nginx 需 `proxy_buffering off` |
| 401 登录失败 | `JWT_SECRET` 变更会使旧 token 失效 |
| 管理后台 401 | `ADMIN_SECRET` 与登录页、`X-Admin-Key` 完全一致 |
| 注册/管理 500 / `JWT_SECRET is not configured` | `.env` 须在 `/opt/safebase/backend/.env`；首次部署需 `scp` 上传；更新后用 `pm2 restart --update-env` |
| Mac 打包 Linux 解压 `LIBARCHIVE.xattr` 警告 | 无害；打包时加 `COPYFILE_DISABLE=1`（见 `scripts/deploy-upload.sh`） |
| 管理后台 500 | `DATABASE_URL` 端口是否与 `docker-compose.yml` 映射一致（默认 5433） |
| 注册 500 / `role "postgres" does not exist` | 后端连到了错误 Postgres；确认 `DATABASE_URL` 指向 Docker 而非本机 5432 |
| 主站白屏 | `ls /opt/safebase/front/assets/` 是否存在；Nginx `root` 须为 `/opt/safebase/front` |
| Nginx `redirection cycle` | `root` 与解压目录不一致；确认 `index.html` 在 `root` 下 |
| 内存不足 | 加 swap；单容器 Postgres 比多组件栈更省内存 |

## 11. 安全提醒

- 勿将 `.env`、数据库密码提交 Git
- `JWT_SECRET`、`ADMIN_SECRET`、DB 密码仅服务器持有
- Postgres 端口不对公网开放；生产使用 HTTPS
- 从其他旧库迁移需自行导出并写入 `public.users` 等表结构
- 用户数据访问控制分阶段演进（Admin 不看正文、DB 仅 backend 账号等）见 **[SECURITY_EVOLUTION.md](./SECURITY_EVOLUTION.md)**
