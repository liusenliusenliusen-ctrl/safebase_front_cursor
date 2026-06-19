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
  ├─ http://服务器IP/           → Nginx → /opt/safebase/front/dist
  │     /api/*                  → proxy → 127.0.0.1:8000（backend）
  ├─ http://服务器IP:8081/      → Nginx → /opt/safebase/admin/dist
  │     /api/*                  → proxy → 127.0.0.1:8000
  └─ 对话流式 SSE               → 同上 /api/chat/stream（proxy_buffering off）

backend (:8000)
  ├─ 全部 /api/*
  └─ cron → node dist/scripts/run-tasks.js

Postgres (:5432，仅本机)
  docker compose（backend 仓库）
```

推荐主站与 API **同源**：Nginx 反代 `/api`，前端构建时 **不必** 设置 `VITE_API_BASE_URL`。

## 2. 服务器要求

| 项 | 建议 |
|----|------|
| 规格 | 2 vCPU + 4 GiB 可跑通；建议 2–4 GiB swap |
| 系统 | Linux，Docker Compose v2、Node 18+、Nginx、PM2 |
| 端口 | 80/443（Nginx）；**5432 勿对公网开放** |
| 出站 | OpenRouter API |

## 3. 部署数据库

在服务器 `safebase_backend_cursor`：

```bash
cd /opt/safebase/backend-src   # 或你 clone 的路径
docker compose up -d
docker compose ps              # 确认 healthy
```

默认连接串（仅本机）：

```text
postgresql://postgres:postgres@127.0.0.1:5432/safebase
```

**生产务必修改** `docker-compose.yml` 中的 `POSTGRES_PASSWORD`，并同步 `backend/.env` 的 `DATABASE_URL`。

新 migration：将 SQL 文件放入 `sql/migrations/`，对已存在库需手动执行（或重建 volume）。

## 4. 配置后端

`/opt/safebase/backend/.env`：

```env
DATABASE_URL=postgresql://postgres:你的密码@127.0.0.1:5432/safebase
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
```

## 5. 构建与上传应用

在开发机三个仓库父目录：

### 5.1 主站

```bash
cd safebase_front_cursor
npm ci && npm run build
# VITE_API_BASE_URL 留空（依赖 Nginx /api 反代）
tar czf front.tar.gz -C safebase_front_cursor dist
```

### 5.2 管理后台

```bash
cd safebase_admin_cursor
npm ci && npm run build
tar czf admin.tar.gz -C safebase_admin_cursor dist
```

### 5.3 后端

```bash
cd safebase_backend_cursor
npm ci && npm run build
tar czf backend.tar.gz -C safebase_backend_cursor \
  package.json package-lock.json dist prompts sql docker-compose.yml scripts/cron.example
```

### 5.4 上传

```bash
scp front.tar.gz admin.tar.gz backend.tar.gz user@服务器:/opt/safebase/
scp safebase_backend_cursor/.env user@服务器:/opt/safebase/backend.env
```

服务器解压：

```bash
sudo mkdir -p /opt/safebase/{front,admin,backend}
cd /opt/safebase
tar xzf front.tar.gz -C front
tar xzf admin.tar.gz -C admin
tar xzf backend.tar.gz -C backend
mv backend.env backend/.env
cd backend && npm ci --omit=dev
```

## 6. Nginx

```bash
cat > /etc/nginx/conf.d/safebase.conf <<'EOF'
server {
    listen 80;
    server_name _;
    root /opt/safebase/front/dist;
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
    root /opt/safebase/admin/dist;
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
| Postgres | `docker compose ps` healthy |
| API | `curl /api/health` → `{"ok":true}` |
| 主站 | 浏览器注册、登录、发消息有流式回复 |
| 管理后台 | `http://IP:8081/` + `ADMIN_SECRET` 能看到用户 |

## 9. 更新发布

1. Schema 变更：执行新 SQL 或重建 DB volume（会丢数据）
2. 后端：`npm run build` → 上传 → `pm2 restart safebase-backend`
3. 前端：重新 `npm run build` → 覆盖 `front/dist`、`admin/dist`
4. `nginx -t && systemctl reload nginx`

## 10. 常见问题

| 现象 | 处理 |
|------|------|
| 对话无回复 / 502 | 检查 `OPENROUTER_API_KEY`、backend 日志 |
| 流式中断 | Nginx 需 `proxy_buffering off` |
| 401 登录失败 | `JWT_SECRET` 变更会使旧 token 失效 |
| 管理后台 401 | `ADMIN_SECRET` 与登录页一致 |
| 管理后台 500 | `DATABASE_URL` 能否连上 Docker Postgres |
| 内存不足 | 加 swap；单容器 Postgres 比多组件栈更省内存 |

## 11. 安全提醒

- 勿将 `.env`、数据库密码提交 Git
- `JWT_SECRET`、`ADMIN_SECRET`、DB 密码仅服务器持有
- Postgres 端口不对公网开放；生产使用 HTTPS
- 从其他旧库迁移需自行导出并写入 `public.users` 等表结构
