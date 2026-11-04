#!/usr/bin/env bash
# Restart Ollama, the authenticated proxy, and the Cloudflare quick tunnel.
# Safe to run again after the Cloud Agent VM resumes. Does not print secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="$ROOT/.secrets"
MODELS="$ROOT/.ollama/models"
TOKEN_FILE="$SECRETS/token"
ENV_FILE="$SECRETS/inference.env"
LOG_DIR="$ROOT/.secrets/logs"
PROXY_PORT="${INFERENCE_PROXY_PORT:-11435}"

mkdir -p "$SECRETS" "$MODELS" "$LOG_DIR"
chmod 700 "$SECRETS"

if [[ ! -s "$TOKEN_FILE" ]]; then
  umask 077
  python3 -c 'import secrets; print(secrets.token_urlsafe(32), end="")' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

export OLLAMA_HOST="127.0.0.1:11434"
export OLLAMA_MODELS="$MODELS"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-10m}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"

if ! curl -sf --max-time 2 "http://127.0.0.1:11434/api/tags" >/dev/null; then
  if command -v tmux >/dev/null 2>&1 && [[ -f /exec-daemon/tmux.portal.conf ]]; then
    tmux -f /exec-daemon/tmux.portal.conf has-session -t "=ollama-serve" 2>/dev/null || \
      tmux -f /exec-daemon/tmux.portal.conf new-session -d -s ollama-serve -c "$ROOT"
    tmux -f /exec-daemon/tmux.portal.conf send-keys -t "ollama-serve:0.0" \
      "export OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS='$MODELS' OLLAMA_KEEP_ALIVE='${OLLAMA_KEEP_ALIVE}' OLLAMA_NUM_PARALLEL='${OLLAMA_NUM_PARALLEL}'; exec ollama serve" C-m
  else
    nohup ollama serve >>"$LOG_DIR/ollama.log" 2>&1 &
    echo $! >"$LOG_DIR/ollama.pid"
  fi
fi

for _ in $(seq 1 30); do
  curl -sf --max-time 2 "http://127.0.0.1:11434/api/tags" >/dev/null && break
  sleep 1
done
curl -sf --max-time 5 "http://127.0.0.1:11434/api/tags" >/dev/null

if ! ollama list | grep -q 'llama3.2:1b'; then
  avail_kb="$(df -Pk "$MODELS" | awk 'NR==2 {print $4}')"
  if [[ "${avail_kb}" -lt 3000000 ]]; then
    echo "Not enough free disk to download llama3.2:1b" >&2
    exit 1
  fi
  ollama pull llama3.2:1b
fi

# Restart proxy so it reloads the token file.
if [[ -f "$LOG_DIR/proxy.pid" ]]; then
  kill "$(cat "$LOG_DIR/proxy.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/proxy.pid"
fi
INFERENCE_TOKEN_FILE="$TOKEN_FILE" \
INFERENCE_PROXY_LISTEN="127.0.0.1:${PROXY_PORT}" \
OLLAMA_UPSTREAM="http://127.0.0.1:11434" \
  nohup python3 "$ROOT/scripts/inference_proxy.py" >>"$LOG_DIR/proxy.log" 2>&1 &
echo $! >"$LOG_DIR/proxy.pid"

for _ in $(seq 1 20); do
  if curl -sf --max-time 2 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PROXY_PORT}/api/tags" | grep -q 401; then
    break
  fi
  sleep 0.3
done

if [[ -f "$LOG_DIR/cloudflared.pid" ]]; then
  kill "$(cat "$LOG_DIR/cloudflared.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/cloudflared.pid"
fi
: >"$LOG_DIR/cloudflared.log"
nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PROXY_PORT}" >>"$LOG_DIR/cloudflared.log" 2>&1 &
echo $! >"$LOG_DIR/cloudflared.pid"

url=""
for _ in $(seq 1 40); do
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" | head -n 1 || true)"
  [[ -n "$url" ]] && break
  sleep 0.5
done
if [[ -z "$url" ]]; then
  echo "Cloudflare tunnel did not publish a URL. See .secrets/logs/cloudflared.log" >&2
  exit 1
fi

umask 077
python3 - "$ENV_FILE" "$url" "$TOKEN_FILE" << 'PY'
import pathlib, sys
env_path, url, token_path = sys.argv[1:]
token = pathlib.Path(token_path).read_text(encoding="utf-8").strip()
path = pathlib.Path(env_path)
path.write_text(
    "OLLAMA_BASE_URL=%s\nOLLAMA_TOKEN=%s\n" % (url, token),
    encoding="utf-8",
)
path.chmod(0o600)
PY

echo "Ollama is on 127.0.0.1:11434 (loopback only)."
echo "Authenticated proxy is on 127.0.0.1:${PROXY_PORT}."
echo "Public base URL (no secret): ${url}"
echo "Credentials for Windows are in ${ENV_FILE} (gitignored). Do not commit that file."
