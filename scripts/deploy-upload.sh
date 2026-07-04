#!/bin/bash
# 在本机 Mac 终端执行（会提示输入 SSH 密码一次）
set -euo pipefail

SERVER="${DEPLOY_SERVER:-root@118.196.122.208}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="$(cd "$ROOT/.." && pwd)"

echo "=== 构建 ==="
cd "$PARENT/safebase_front_cursor" && npm run build
cd "$PARENT/safebase_admin_cursor" && npm run build
cd "$PARENT/safebase_backend_cursor" && npm run build

echo "=== 打包（禁用 macOS xattr，避免 Linux 解压警告）==="
COPYFILE_DISABLE=1 tar czf /tmp/front.tar.gz -C "$PARENT/safebase_front_cursor/dist" .
COPYFILE_DISABLE=1 tar czf /tmp/admin.tar.gz -C "$PARENT/safebase_admin_cursor/dist" .
COPYFILE_DISABLE=1 tar czf /tmp/backend.tar.gz -C "$PARENT/safebase_backend_cursor" \
  package.json package-lock.json dist prompts sql docker-compose.yml scripts/cron.example

echo "=== 上传 ==="
scp /tmp/front.tar.gz /tmp/admin.tar.gz /tmp/backend.tar.gz \
  "$ROOT/scripts/deploy-server.sh" \
  "$SERVER:/tmp/"

echo "=== 服务器部署 ==="
ssh "$SERVER" 'chmod +x /tmp/deploy-server.sh && bash /tmp/deploy-server.sh'

echo "=== 外网验证（可选）==="
HOST="${DEPLOY_SERVER#*@}"
curl -sf "http://${HOST}/api/health" && echo " OK" || echo "外网 health 失败，请检查 Nginx"
