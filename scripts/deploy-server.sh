#!/bin/bash
# 在服务器上执行（/tmp 下已有 front/admin/backend 的 tar.gz）
set -euo pipefail

BASE=/opt/safebase
TMP=/tmp

echo "=== 解压应用 ==="
mkdir -p "$BASE"/{front,admin,backend}
# 保留已有 .env（部署包不含密钥）
if [ -f "$BASE/backend/.env" ]; then
  cp -a "$BASE/backend/.env" "$TMP/safebase-backend.env.bak"
fi
rm -rf "$BASE/front"/* "$BASE/admin"/*
tar xzf "$TMP/front.tar.gz" -C "$BASE/front"
tar xzf "$TMP/admin.tar.gz" -C "$BASE/admin"
tar xzf "$TMP/backend.tar.gz" -C "$BASE/backend"
if [ -f "$TMP/safebase-backend.env.bak" ]; then
  mv "$TMP/safebase-backend.env.bak" "$BASE/backend/.env"
  chmod 600 "$BASE/backend/.env"
fi

if [ ! -f "$BASE/backend/.env" ]; then
  echo "ERROR: 缺少 $BASE/backend/.env（含 JWT_SECRET、DATABASE_URL、OPENROUTER_API_KEY）"
  echo "请在本机执行: scp safebase_backend_cursor/.env root@服务器IP:/opt/safebase/backend/.env"
  exit 1
fi

test -f "$BASE/front/index.html"
test -f "$BASE/front/assets/"*.js
test -f "$BASE/backend/dist/src/index.js"

echo "=== 数据库 ==="
cd "$BASE/backend"
docker compose up -d
docker compose ps

echo "=== 后端依赖与 PM2 ==="
npm ci --omit=dev
if pm2 describe safebase-backend >/dev/null 2>&1; then
  pm2 restart safebase-backend --update-env
else
  pm2 start dist/src/index.js --name safebase-backend
fi
pm2 save

echo "=== 健康检查 ==="
sleep 2
curl -sf http://127.0.0.1:8000/api/health
echo ""

echo "=== Nginx ==="
nginx -t
systemctl reload nginx

echo "=== 完成 ==="
ls -la "$BASE/front/index.html" "$BASE/backend/dist/src/index.js"
pm2 status
