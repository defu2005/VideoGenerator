#!/usr/bin/env bash
# Install Video Agent on a Linux machine. Idempotent: an existing .env and data
# directory are left in place. Docker is never installed by this script.
set -euo pipefail

VG_HOME="${VG_HOME:-/opt/vg}"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
DOCKER_DIR="$SCRIPT_DIR/docker"

if ! command -v docker >/dev/null 2>&1; then
  echo "Chưa có Docker. Script này không tự cài."
  echo "Trên Ubuntu/Debian, làm theo hướng dẫn chính thức rồi chạy lại:"
  echo "  https://docs.docker.com/engine/install/ubuntu/"
  echo "  https://docs.docker.com/compose/install/linux/"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Lệnh docker có nhưng daemon chưa chạy. Mở Docker rồi chạy lại script."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Chưa có Docker Compose v2 (lệnh 'docker compose'). Script này không tự cài."
  echo "  https://docs.docker.com/compose/install/linux/"
  exit 1
fi

role="${1:-${VG_INSTALL_ROLE:-}}"
if [ -z "$role" ]; then
  if [ -t 0 ]; then
    echo "Cài máy này làm gì?"
    echo "  1) control — giao diện, API, cơ sở dữ liệu"
    echo "  2) worker — máy render, nối tới control"
    read -r -p "Chọn 1 hoặc 2: " choice
    case "$choice" in
      1|control) role=control ;;
      2|worker) role=worker ;;
      *) echo "Chọn 1 hoặc 2."; exit 1 ;;
    esac
  else
    echo "Không có terminal để hỏi. Chạy: bash deploy/install.sh control    hoặc    bash deploy/install.sh worker"
    exit 1
  fi
fi

case "$role" in
  control|worker) ;;
  *) echo "Vai trò phải là control hoặc worker."; exit 1 ;;
esac

if ! mkdir -p "$VG_HOME" 2>/dev/null; then
  echo "Không tạo được $VG_HOME. Chạy lại bằng tài khoản có quyền ghi thư mục đó."
  exit 1
fi

if [ -d "$VG_HOME/data" ]; then
  echo "Giữ nguyên thư mục dữ liệu $VG_HOME/data"
fi
mkdir -p "$VG_HOME/data"

copy_if_different() {
  local source="$1"
  local target="$2"
  if [ "$(cd "$(dirname "$source")" && pwd)/$(basename "$source")" = "$(cd "$(dirname "$target")" && pwd)/$(basename "$target")" ]; then
    return 0
  fi
  cp -f "$source" "$target"
}

copy_if_different "$DOCKER_DIR/compose.control.yml" "$VG_HOME/compose.control.yml"
copy_if_different "$DOCKER_DIR/compose.worker.yml" "$VG_HOME/compose.worker.yml"
copy_if_different "$DOCKER_DIR/Caddyfile" "$VG_HOME/Caddyfile"
copy_if_different "$DOCKER_DIR/litestream.yml" "$VG_HOME/litestream.yml"

rand_b64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

set_kv() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp=$(mktemp)
  awk -v k="$key" -v v="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" k "=" { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

env_value() {
  local key="$1"
  grep -E "^${key}=" "$VG_HOME/.env" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true
}

require_env() {
  local key="$1"
  if [ -z "$(env_value "$key")" ]; then
    echo "Thiếu ${key} trong ${VG_HOME}/.env. Sửa file đó rồi chạy lại. Script không ghi đè .env đã có."
    exit 1
  fi
}

image="${VG_IMAGE:-vg:dev}"

if [ ! -f "$VG_HOME/.env" ]; then
  if [ ! -f "$REPO_ROOT/.env.example" ]; then
    echo "Không thấy $REPO_ROOT/.env.example"
    exit 1
  fi
  umask 077
  tr -d '\r' < "$REPO_ROOT/.env.example" > "$VG_HOME/.env"
  domain=":80"
  web_base="http://127.0.0.1"
  control_url="${VG_CONTROL_URL:-}"
  join_token="${VG_JOIN_TOKEN:-}"
  if [ "$role" = "control" ]; then
    if [ -n "${VG_DOMAIN:-}" ]; then
      domain="$VG_DOMAIN"
    elif [ -t 0 ]; then
      read -r -p "Tên miền (Enter nếu chỉ dùng trong LAN, cổng 80): " domain_input || true
      domain="${domain_input:-:80}"
    fi
    if [ -n "$domain" ] && [ "$domain" != ":80" ]; then
      web_base="https://${domain}"
    else
      domain=":80"
      web_base="http://127.0.0.1"
    fi
  else
    if [ -z "$control_url" ] && [ -t 0 ]; then
      read -r -p "URL của control plane: " control_url
    fi
    if [ -z "$join_token" ] && [ -t 0 ]; then
      read -r -s -p "Join token: " join_token
      echo
    fi
    if [ -z "$control_url" ] || [ -z "$join_token" ]; then
      echo "Worker cần VG_CONTROL_URL và VG_JOIN_TOKEN."
      exit 1
    fi
  fi
  set_kv "$VG_HOME/.env" HOST "0.0.0.0"
  set_kv "$VG_HOME/.env" DATA_DIR "/data"
  set_kv "$VG_HOME/.env" DATABASE_PATH "/data/app.db"
  set_kv "$VG_HOME/.env" TOKEN_ENCRYPTION_KEY "$(rand_b64)"
  set_kv "$VG_HOME/.env" BETTER_AUTH_SECRET "$(rand_b64)"
  set_kv "$VG_HOME/.env" WEB_BASE_URL "$web_base"
  set_kv "$VG_HOME/.env" CORS_ORIGIN "$web_base"
  set_kv "$VG_HOME/.env" DOMAIN "$domain"
  set_kv "$VG_HOME/.env" VG_HTTP_PORT "80"
  set_kv "$VG_HOME/.env" VG_HTTPS_PORT "443"
  set_kv "$VG_HOME/.env" VG_IMAGE "$image"
  set_kv "$VG_HOME/.env" VG_DATA_DIR "$VG_HOME/data"
  set_kv "$VG_HOME/.env" VG_CACHE_DIR "$VG_HOME/data"
  set_kv "$VG_HOME/.env" VG_ROLE "$role"
  if [ "$role" = "worker" ]; then
    set_kv "$VG_HOME/.env" VG_CONTROL_URL "$control_url"
    set_kv "$VG_HOME/.env" VG_JOIN_TOKEN "$join_token"
  fi
  chmod 600 "$VG_HOME/.env"
  echo "Đã tạo $VG_HOME/.env"
else
  echo "Giữ nguyên $VG_HOME/.env"
fi

if [ "$role" = "worker" ]; then
  require_env VG_CONTROL_URL
  require_env VG_JOIN_TOKEN
fi

if [[ "$image" == */* ]]; then
  docker pull "$image"
else
  docker build -f "$DOCKER_DIR/Dockerfile" -t "$image" "$REPO_ROOT"
fi

(
  cd "$VG_HOME"
  if [ "$role" = "worker" ]; then
    docker compose -f compose.worker.yml up -d
  else
    docker compose -f compose.control.yml up -d
  fi
)

echo
if [ "$role" = "worker" ]; then
  echo "Container worker đã chạy và sẽ tự nối tới control. Xem trạng thái ở Cài đặt → Máy worker."
  echo "Dữ liệu cache: $VG_HOME/data"
  echo "URL control: $(env_value VG_CONTROL_URL)"
else
  domain="$(env_value DOMAIN)"
  http_port="$(env_value VG_HTTP_PORT)"
  http_port="${http_port:-80}"
  if [ -z "$domain" ] || [ "$domain" = ":80" ]; then
    echo "Mở http://<ip-máy-này>/ trên cổng ${http_port}."
    echo "Trong LAN, đừng mở cổng này ra Internet cho đến khi có đăng nhập (TASK-114)."
  else
    echo "Mở https://${domain}/ sau khi DNS trỏ về máy này."
    echo "Cổng ${http_port} và 443 phải tới được từ Internet để Caddy lấy chứng chỉ."
  fi
  echo "Bước tiếp: điền khoá API trong $VG_HOME/.env rồi chạy lại script, hoặc dùng nhà cung cấp khoá trong trang Kết nối."
  echo "CLI đã đăng nhập (claude, agy, cursor-agent) và OmniRoute không nằm trong image. Xem deploy/README.md."
  echo "Sao lưu: copy $VG_HOME/data khi đã dừng, hoặc bật profile litestream."
fi
