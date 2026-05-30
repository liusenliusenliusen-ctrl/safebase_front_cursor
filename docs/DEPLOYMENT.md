# SafeBase 生产部署指南（火山 Supabase + 服务器）

面向已在**本地联调成功**（火山 Supabase + 三仓库）的场景：服务器只部署 **front / admin / backend**；数据库、Auth、Edge Functions 运行在**火山 Supabase 云端**。

| 仓库 | 服务器角色 | 产物 | 服务器上是否需要常驻进程 |
|------|------------|------|--------------------------|
| `safebase_front_cursor` | 主站静态页 | `dist/` | **否** — Nginx 直接读文件 |
| `safebase_admin_cursor` | 管理后台静态页 | `dist/` | **否** — Nginx 直接读文件 |
| `safebase_backend_cursor` | Node API + 夜间 cron | `dist/` + `package.json` | **是** — PM2 跑 `dist/src/index.js` |

主站与管理后台在本地 `npm run build` 后即为纯静态 HTML/JS/CSS；**解压到 `/opt/safebase/front/dist` 与 `admin/dist` 即算「部署完成」**，没有 `pm2 start front` 这一步。浏览器访问主站时的登录、对话请求直连**火山 Supabase**（Edge Function），不经过 VPS 上的 Node 进程。

相关文档：[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)（架构与本地开发）

---

## 1. 架构

```text
用户浏览器
  ├─ www.yourdomain.com     → Nginx → /opt/safebase/front/dist
  ├─ admin.yourdomain.com   → Nginx → /opt/safebase/admin/dist
  │                              └─ /api → 127.0.0.1:8000 (backend)
  └─ 主站对话/登录            → 火山 Supabase（HTTPS）
       ├─ Auth / PostgREST
       └─ Edge Function: stream-chat

backend (:8000)
  ├─ GET /api/admin/*       → 管理后台
  └─ cron → run-tasks.js    → 同一 Postgres（直连 DATABASE_URL）
```

**不在 VPS 上部署：** Supabase 实例、Edge Functions（在火山控制台维护）。

---

## 2. 云端前置条件（火山 Supabase）

部署服务器前，在火山控制台确认：

| 项 | 说明 |
|----|------|
| 数据库迁移 | 已按顺序执行 `supabase/migrations/` 下 10 个 SQL 文件 |
| Edge Function | 已部署 `stream-chat`，URL 为 `.../functions/v1/stream-chat` |
| Edge Secrets | 至少配置 `OPENROUTER_API_KEY`；建议另配 `OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-large`、`OPENROUTER_EMBEDDING_DIMENSIONS=2048` |
| 公网访问 | 项目已开通公网（Edge 调用 OpenRouter 需要） |
| 数据库连接串 | 控制台「数据库连接」中获取 `postgresql://...`（供 backend `DATABASE_URL`） |

验证 Edge 是否在线（无 token 时应为 **401**，不是 `function not found`）：

```bash
curl -i "https://你的项目.supabase.aidap-global.cn-beijing.volces.com/functions/v1/stream-chat"
```

---

## 3. 本地打包

在三个仓库的父目录（例如 `trae_projects`）执行。

### 3.1 主站 front

```bash
cd safebase_front_cursor

# 生产构建变量（构建时打入前端，不可用 .env 开发文件代替）
# 可复制 .env.production 为构建输入：
cp .env.production .env.production.local   # 可选

# .env.production 必须包含：
# VITE_SUPABASE_URL=https://xxx.supabase.aidap-global.cn-beijing.volces.com
# VITE_SUPABASE_ANON_KEY=你的_anon_public_key

npm ci
npm run build
# 产物：dist/
```

```bash
cd ..   # 回到父目录
tar czf front.tar.gz -C safebase_front_cursor dist
```

### 3.2 管理后台 admin

```bash
cd safebase_admin_cursor

# 若 API 与 admin 同域且 Nginx 反代 /api → :8000，可不建 .env
# 若 API 独立域名，创建 .env.production：
# VITE_API_BASE_URL=https://api.yourdomain.com

npm ci
npm run build
# 产物：dist/
```

```bash
cd ..
tar czf admin.tar.gz -C safebase_admin_cursor dist
```

### 3.3 后端 backend

```bash
cd safebase_backend_cursor

npm ci
npm run build
# 入口：dist/src/index.js（不是 dist/index.js）
```

```bash
cd ..
tar czf backend.tar.gz -C safebase_backend_cursor \
  package.json package-lock.json dist prompts scripts/cron.example
```

### 3.4 上传到服务器

```bash
scp front.tar.gz admin.tar.gz backend.tar.gz user@服务器IP:/opt/safebase/

# 后端 .env 单独传，不要打进 tar
scp safebase_backend_cursor/.env user@服务器IP:/opt/safebase/backend.env
```

---

## 4. 服务器环境

```bash
ssh user@服务器IP

# Node.js 18+（Ubuntu 示例）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx

node -v   # >= 18
npm -v

# 进程守护（推荐）
sudo npm install -g pm2
```

### 4.1 CentOS / RHEL 8（无域名、RPM 装 Nginx）

CentOS Stream 8 上 `dnf install nginx` 可能无匹配包，可用官方 RPM：

```bash
cd /tmp
curl -LO http://nginx.org/packages/rhel/8/x86_64/RPMS/nginx-1.30.2-1.el8.ngx.x86_64.rpm
curl -LO https://nginx.org/keys/nginx_signing.key
rpm --import nginx_signing.key
rpm -ivh nginx-1.30.2-1.el8.ngx.x86_64.rpm
systemctl enable --now nginx
nginx -v
systemctl status nginx   # 应 Active: active (running)
```

配置写在 **`/etc/nginx/conf.d/`**（不是 Ubuntu 的 `sites-available`）。无 `nano` 时用 `vi`，或 §7.1 的 `cat > ... <<'EOF'` 一键写入。

放行端口（本机 firewalld + 云厂商安全组）：

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-port=8081/tcp
firewall-cmd --reload
```

---

## 5. 解压与目录

```bash
sudo mkdir -p /opt/safebase/{front,admin,backend}
sudo chown -R $USER:$USER /opt/safebase

cd /opt/safebase
tar xzf front.tar.gz   -C front
tar xzf admin.tar.gz   -C admin
tar xzf backend.tar.gz -C backend

mv backend.env backend/.env
nano backend/.env    # 核对下列变量
```

### 5.1 `backend/.env` 示例

```env
DATABASE_URL=postgresql://postgres:密码@主机:5432/postgres
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-large
OPENROUTER_EMBEDDING_DIMENSIONS=2048
OPENROUTER_CHAT_MODEL=deepseek/deepseek-chat
ADMIN_SECRET=你的管理后台登录密钥
PORT=8000
```

- `DATABASE_URL`：火山控制台数据库**直连**串（端口一般为 5432）。
- `OPENROUTER_API_KEY`：与火山 Edge Secrets 可用同一把 key；供**夜间 cron 批处理**用。主站对话走 Edge，不读 backend 的 key。未配置时服务仍能启动，但日志会警告、批处理不可用。
- `ADMIN_SECRET`：**自行设定**的管理后台登录密码（非 Supabase/OpenRouter 控制台可查字段）。登录 admin 页时输入与 `.env` 完全相同的字符串。可用 `openssl rand -base64 32` 生成。

`.env` 路径必须为 **`/opt/safebase/backend/.env`**（与 `package.json` 同级）。启动命令在 `backend` 目录执行：`node dist/src/index.js`。

### 5.2 安装后端依赖

```bash
cd /opt/safebase/backend
npm ci --omit=dev
```

### 5.3 验证文件

```bash
ls /opt/safebase/front/dist/index.html
ls /opt/safebase/admin/dist/index.html
ls /opt/safebase/backend/dist/src/index.js
```

### 5.4 主站 / 管理后台「上线」（无单独启动命令）

front 与 admin **不需要**在服务器上执行 `npm run dev`、`npm start` 或 PM2。流程是：

1. **本地**已用 `.env.production` 打好包（见 §3.1、§3.2）。
2. **服务器**解压到 `/opt/safebase/front/dist`、`/opt/safebase/admin/dist`（见 §5）。
3. **Nginx** 配置 `root` 指向上述目录并重载（见 §7）— 这一步即主站与管理后台的「启动」。
4. 浏览器打开页面后，主站 JS 直连火山 Supabase；管理后台的 `/api` 由 Nginx 反代到本机 `:8000`。

验证 Nginx 已托管静态文件（在配置好 §7 之后）：

```bash
curl -I http://127.0.0.1/              # 主站，应 200
curl -I http://127.0.0.1:8081/         # 无域名时用 8081 端口访问 admin（见 §7.1）
```

---

## 6. 启动 backend

```bash
cd /opt/safebase/backend

# 临时测试
node dist/src/index.js

# 生产（PM2）
pm2 start dist/src/index.js --name safebase-backend
pm2 save
pm2 startup          # 按终端提示执行，实现开机自启

# 验证管理 API
curl http://127.0.0.1:8000/api/admin/users \
  -H "X-Admin-Key: 你的ADMIN_SECRET"
```

---

## 7. Nginx（托管 front / admin 静态站）

Nginx 同时承担 **主站** 与 **管理后台** 的「启动」：配置 `root` 并重载后，静态页即可访问。仅 **backend** 需要 PM2。

### 7.1 无域名：IP + 端口（CentOS / RHEL 用 `conf.d`）

```bash
# 若默认站点占 80，可先备份
mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak 2>/dev/null || true

cat > /etc/nginx/conf.d/safebase.conf <<'EOF'
# 主站 — 80
server {
    listen 80;
    server_name _;
    root /opt/safebase/front/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# 管理后台 — 8081（/api 反代 backend）
server {
    listen 8081;
    server_name _;
    root /opt/safebase/admin/dist;
    index index.html;
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

nginx -t && systemctl reload nginx
# 防火墙：80、8081；CentOS SELinux 若 API 502：setsebool -P httpd_can_network_connect 1
```

访问：`http://服务器IP/`（主站）、`http://服务器IP:8081/`（管理后台）。admin 构建时不要设置 `VITE_API_BASE_URL`，走相对路径 `/api`。

**部署顺序建议：** 先 §5 解压并确认 `front/dist/index.html` 存在 → 再写本节配置 → `nginx -t && systemctl reload nginx`。

### 7.1.1 确认 Nginx 已启动且指向 SafeBase

```bash
systemctl is-active nginx          # 应输出 active
curl -I http://127.0.0.1/          # 应 HTTP/1.1 200
curl -s http://127.0.0.1/ | head -3   # 不应出现 "Welcome to nginx"
ls /opt/safebase/front/dist/index.html
```

若浏览器仍显示 **Welcome to nginx!**：说明仍在用默认站点，执行：

```bash
mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak
nginx -t && systemctl reload nginx
```

并确认 `/etc/nginx/conf.d/safebase.conf` 中 `root` 为 `/opt/safebase/front/dist`。

### 7.2 有域名：按 server_name 区分（Ubuntu 示例）

将 `www.yourdomain.com`、`admin.yourdomain.com` 替换为实际域名。

```bash
sudo nano /etc/nginx/sites-available/safebase
```

```nginx
# 主站
server {
    listen 80;
    server_name www.yourdomain.com yourdomain.com;

    root /opt/safebase/front/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# 管理后台（/api 反代到 backend）
server {
    listen 80;
    server_name admin.yourdomain.com;

    root /opt/safebase/admin/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/safebase /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS：使用 certbot 或云厂商证书，为上述 `server_name` 配置 SSL。

若 admin 构建时使用了 `VITE_API_BASE_URL` 指向独立 API 域名，可另建 `api.yourdomain.com` 的 server 块反代 `:8000`，admin 的 Nginx 则不必配置 `/api` 反代。

---

## 8. 夜间批处理（cron）

```bash
crontab -e
```

```cron
30 23 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js daily >> /var/log/safebase-daily.log 2>&1
10  0 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js profiles >> /var/log/safebase-profiles.log 2>&1
30  0 * * * cd /opt/safebase/backend && node dist/scripts/run-tasks.js anchors >> /var/log/safebase-anchors.log 2>&1
```

`node` 路径以 `which node` 为准（必要时写绝对路径，如 `/usr/bin/node`）。

---

## 9. 上线验证

### 9.1 命令行

```bash
# backend
curl -i http://127.0.0.1:8000/api/admin/users -H "X-Admin-Key: 你的ADMIN_SECRET"

# Edge（401 表示函数存在）
curl -i "https://你的项目.supabase.aidap-global.cn-beijing.volces.com/functions/v1/stream-chat"
```

### 9.2 浏览器

| 地址 | 预期 |
|------|------|
| `http://服务器IP/` | SafeBase 主站（非 Nginx 欢迎页） |
| `http://服务器IP:8081/` | 管理后台登录页 |
| 主站注册/登录、发消息 | 流式回复（火山 Supabase + Edge） |
| 管理后台 | 输入 `.env` 中 `ADMIN_SECRET` → 用户列表正常 |

---

## 10. 目录结构

```text
/opt/safebase/
├── front.tar.gz          # 上传包（可删）
├── admin.tar.gz
├── backend.tar.gz
├── front/
│   └── dist/
├── admin/
│   └── dist/
└── backend/
    ├── .env
    ├── package.json
    ├── package-lock.json
    ├── dist/
    │   ├── src/index.js
    │   └── scripts/run-tasks.js
    └── prompts/
```

---

## 11. 更新发布流程

代码变更后：

1. 本地对应仓库 `npm run build`（backend 需 `npm run build`）。
2. 重新打 `front.tar.gz` / `admin.tar.gz` / `backend.tar.gz`。
3. `scp` 上传并解压覆盖。
4. `pm2 restart safebase-backend`。
5. `sudo nginx -t && sudo systemctl reload nginx`。

仅改前端时，只需重新构建并覆盖 `front/dist`（及必要时 `admin/dist`）。

---

## 12. 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| 对话 `function not found` | Edge 未部署或 slug 不是 `stream-chat` | 控制台确认 URL 为 `/functions/v1/stream-chat` |
| `Invalid value for dimensions = 2048` | embedding 用了 small 模型 | Secrets 改为 `text-embedding-3-large` + `2048`，重新 Deploy Edge |
| `node dist/index.js` 找不到 | 入口路径错误 | 使用 `node dist/src/index.js` |
| 管理后台 401 | 密钥不一致 | `ADMIN_SECRET` 与登录页输入相同 |
| 管理后台 API 失败 | 未反代 `/api` | 配置 Nginx `/api` 或构建时设置 `VITE_API_BASE_URL` |
| 主站连不上 Supabase | 构建时 URL/anon key 错误 | 检查 `.env.production` 后重新 `npm run build` |
| 找不到 front 启动命令 | front 是静态站，无 PM2 | 解压 `dist` + Nginx `root` 指向该目录即可（§5.4、§7） |
| 访问 IP 显示 **Welcome to nginx!** | 默认 `default.conf` 占 80，或未指到 `front/dist` | 备份 `default.conf`、写入 §7.1 `safebase.conf`、确认 `dist` 已解压（§7.1.1） |
| `未配置 OPENROUTER_API_KEY` 警告 | `backend/.env` 缺项或未读到 | 编辑 `/opt/safebase/backend/.env` 后重启 backend；见 §5.1 |
| `ADMIN_SECRET` 在哪查 | 无控制台，需自设 | 写入 `backend/.env`，登录 admin 时输入同一串（§5.1） |

---

## 附录：无域名部署检查清单（CentOS + IP）

1. §3 本地 `npm run build` 并 `scp` 三个 tar + `backend.env`
2. §4.1 安装 Nginx（RPM）+ Node + PM2
3. §5 解压到 `/opt/safebase/`，`mv backend.env backend/.env` 并填写变量
4. §5.2 `npm ci --omit=dev`；§6 PM2 启动 `dist/src/index.js`
5. §7.1 禁用 `default.conf`、写入 `safebase.conf`、`nginx -t && reload`
6. §9 浏览器访问 `http://IP/` 与 `http://IP:8081/`

---

## 13. 安全提醒

- 不要将 `.env`、`backend.env`、`.env.production`（含真实密钥）提交到 Git。
- `anon key` 可进前端；`service_role` 与数据库密码仅用于服务器 backend，勿写入前端构建变量。
- 生产环境务必使用 HTTPS。
