#!/usr/bin/env bash
# 本地开发服务守护进程：关 Cursor / 关终端后仍继续运行
# 用法: ./scripts/dev-local.sh {start|stop|restart|status|logs}

set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-$HOME/Documents/trae_projects/safebase_backend_cursor}"
FRONT_DIR="${FRONT_DIR:-$HOME/Documents/trae_projects/safebase_front_cursor}"
LOG_DIR="$HOME/.safebase/logs"

mkdir -p "$LOG_DIR"

port_pids() {
  local port="$1"
  lsof -ti ":$port" 2>/dev/null | sort -u
}

is_port_listening() {
  local port="$1"
  [[ -n "$(port_pids "$port")" ]]
}

start_one() {
  local name="$1"
  local dir="$2"
  local port="$3"
  local log_file="$LOG_DIR/$name.log"

  if is_port_listening "$port"; then
    echo "[$name] already running on :$port (pid $(port_pids "$port" | tr '\n' ' '))"
    return 0
  fi

  # macOS: 用 osascript 在独立 shell 里启动，避免随 Cursor 终端退出而结束
  if [[ "$(uname -s)" == "Darwin" ]]; then
    osascript -e "do shell script \"cd '$dir' && nohup npm run dev >> '$log_file' 2>&1 &\""
  else
    nohup bash -c "cd '$dir' && exec npm run dev" >>"$log_file" 2>&1 </dev/null &
  fi
  echo "[$name] starting on :$port (log: $log_file)"
}

stop_one() {
  local name="$1"
  local port="$2"
  local pids
  pids="$(port_pids "$port")"

  if [[ -z "$pids" ]]; then
    echo "[$name] not running"
    return 0
  fi

  echo "$pids" | xargs kill 2>/dev/null || true
  sleep 1
  pids="$(port_pids "$port")"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
  echo "[$name] stopped"
}

wait_healthy() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 30); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "[$label] healthy: $url"
      return 0
    fi
    sleep 1
  done
  echo "[$label] not ready yet — check logs in $LOG_DIR"
  return 1
}

cmd_start() {
  start_one backend "$BACKEND_DIR" 8000
  start_one front "$FRONT_DIR" 5173
  wait_healthy "http://127.0.0.1:8000/api/health" backend || true
  wait_healthy "http://localhost:5173" front || true
}

cmd_stop() {
  stop_one front 5173
  stop_one backend 8000
}

cmd_status() {
  if is_port_listening 8000; then
    echo "[backend] running on :8000 (pid $(port_pids 8000 | tr '\n' ' '))"
  else
    echo "[backend] stopped"
  fi
  if is_port_listening 5173; then
    echo "[front] running on :5173 (pid $(port_pids 5173 | tr '\n' ' '))"
  else
    echo "[front] stopped"
  fi
  curl -sf "http://127.0.0.1:8000/api/health" >/dev/null 2>&1 && echo "[health] backend OK" || echo "[health] backend DOWN"
  curl -sf "http://localhost:5173" >/dev/null 2>&1 && echo "[health] front OK" || echo "[health] front DOWN"
}

cmd_logs() {
  local target="${1:-all}"
  case "$target" in
    backend) tail -f "$LOG_DIR/backend.log" ;;
    front)   tail -f "$LOG_DIR/front.log" ;;
    all|*)   tail -f "$LOG_DIR/backend.log" "$LOG_DIR/front.log" ;;
  esac
}

case "${1:-start}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs "${2:-all}" ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs [backend|front]}"
    exit 1
    ;;
esac
