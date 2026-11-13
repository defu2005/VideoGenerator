#!/bin/sh
# Drop to the vg user after the data volume is writable.
# Docker named volumes are root-owned on first mount; the server process is not root.
set -eu
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown vg:vg /data
  exec gosu vg "$@"
fi
exec "$@"
