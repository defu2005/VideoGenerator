#!/usr/bin/env bash
# Stop the tunnel, the auth proxy, and Ollama. Model files are left in place.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.secrets/logs"

stop_pid() {
  local file="$1"
  if [[ -f "$file" ]]; then
    kill "$(cat "$file")" 2>/dev/null || true
    rm -f "$file"
  fi
}

stop_pid "$LOG_DIR/cloudflared.pid"
stop_pid "$LOG_DIR/proxy.pid"
if command -v tmux >/dev/null 2>&1 && [[ -f /exec-daemon/tmux.portal.conf ]]; then
  tmux -f /exec-daemon/tmux.portal.conf kill-session -t "=ollama-serve" 2>/dev/null || true
fi
stop_pid "$LOG_DIR/ollama.pid"
pkill -f "ollama serve" 2>/dev/null || true
pkill -f "inference_proxy.py" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
echo "Stopped tunnel, proxy, and Ollama. Weights under .ollama/ were not deleted."
