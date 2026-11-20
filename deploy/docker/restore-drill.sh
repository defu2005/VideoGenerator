#!/usr/bin/env bash
# ==============================================================================
# restore-drill.sh — Restore drill validation for Video Agent (TASK-143)
#
# Simulates or executes disaster recovery by restoring SQLite database from
# Litestream replica URL or filesystem snapshot into an isolated blank directory,
# then verifying PRAGMA integrity_check and schema validity.
#
# Usage:
#   ./deploy/docker/restore-drill.sh [REPLICA_URL_OR_BACKUP_PATH]
#
# Examples:
#   ./deploy/docker/restore-drill.sh s3://my-bucket/vg-backup
#   ./deploy/docker/restore-drill.sh /backup/vg-2026-11-17/app.db
#   ./deploy/docker/restore-drill.sh (auto-creates a test snapshot and restores)
# ==============================================================================

set -euo pipefail

START_TIME=$(date +%s)
SRC_TARGET="${1:-${LITESTREAM_REPLICA_URL:-}}"
mkdir -p "./tmp" 2>/dev/null || true
if [[ -d "./tmp" ]]; then
  WORK_DIR=$(mktemp -d "./tmp/vg-restore-drill-XXXXXX")
else
  WORK_DIR=$(mktemp -d -t vg-restore-drill-XXXXXX)
fi
RESTORED_DB="${WORK_DIR}/app.db"

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT INT TERM

echo "==> Video Agent Restore Drill (TASK-143)"
echo "    Work directory: ${WORK_DIR}"

# Detect Node or SQLite command
NODE_CMD=""
if command -v node >/dev/null 2>&1; then
  NODE_CMD="node"
elif command -v node.exe >/dev/null 2>&1; then
  NODE_CMD="node.exe"
elif [[ -x "/mnt/c/Program Files/nodejs/node.exe" ]]; then
  NODE_CMD="/mnt/c/Program Files/nodejs/node.exe"
elif [[ -x "/c/Program Files/nodejs/node.exe" ]]; then
  NODE_CMD="/c/Program Files/nodejs/node.exe"
fi

to_os_path() {
  local p="$1"
  if [[ "${NODE_CMD}" == *".exe"* ]] && command -v wslpath >/dev/null 2>&1; then
    wslpath -w "${p}"
  elif [[ "${NODE_CMD}" == *".exe"* ]] && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "${p}"
  else
    echo "${p}"
  fi
}

# 1. Restore database based on source
if [[ -z "${SRC_TARGET}" ]]; then
  echo "    No replica URL provided; creating a self-contained SQLite fixture to drill..."
  FIXTURE_DB="${WORK_DIR}/fixture.db"
  OS_FIXTURE_DB=$(to_os_path "${FIXTURE_DB}")
  if [[ -n "${NODE_CMD}" ]]; then
    "${NODE_CMD}" -e "
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1]);
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT);');
      db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY);');
      db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT);');
      db.exec(\"INSERT INTO projects VALUES ('p1', 'Restored Project');\");
      db.exec(\"INSERT INTO __drizzle_migrations VALUES (1, 'hash-init');\");
      db.close();
    " "${OS_FIXTURE_DB}"
  elif command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "${FIXTURE_DB}" <<EOF
PRAGMA journal_mode=WAL;
CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT);
CREATE TABLE jobs (id TEXT PRIMARY KEY);
CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT);
INSERT INTO projects VALUES ('p1', 'Restored Project');
INSERT INTO __drizzle_migrations VALUES (1, 'hash-init');
EOF
  else
    echo "ERROR: Neither node nor sqlite3 available to create fixture." >&2
    exit 1
  fi
  cp "${FIXTURE_DB}" "${RESTORED_DB}"
  if [[ -f "${FIXTURE_DB}-wal" ]]; then cp "${FIXTURE_DB}-wal" "${RESTORED_DB}-wal"; fi
elif [[ "${SRC_TARGET}" =~ ^(s3://|abs://|gcs://|file://) ]]; then
  echo "    Restoring from Litestream replica: ${SRC_TARGET}..."
  if command -v litestream >/dev/null 2>&1; then
    litestream restore -o "${RESTORED_DB}" "${SRC_TARGET}"
  else
    echo "    Litestream CLI not found in PATH; attempting docker run litestream..."
    # A file:// replica lives on the host, so mount it read-only and point Litestream at the mount.
    DOCKER_REPLICA_URL="${SRC_TARGET}"
    REPLICA_MOUNT=()
    if [[ "${SRC_TARGET}" == file://* ]]; then
      HOST_REPLICA="${SRC_TARGET#file://}"
      if [[ ! -d "${HOST_REPLICA}" ]]; then
        echo "ERROR: file:// replica directory not found: ${HOST_REPLICA}" >&2
        exit 1
      fi
      REPLICA_MOUNT=(-v "$(to_os_path "$(cd "${HOST_REPLICA}" && pwd)"):/replica:ro")
      DOCKER_REPLICA_URL="file:///replica"
    fi
    MSYS_NO_PATHCONV=1 docker run --rm \
      -v "$(to_os_path "${WORK_DIR}"):/restore" \
      "${REPLICA_MOUNT[@]}" \
      -e LITESTREAM_ACCESS_KEY_ID="${LITESTREAM_ACCESS_KEY_ID:-}" \
      -e LITESTREAM_SECRET_ACCESS_KEY="${LITESTREAM_SECRET_ACCESS_KEY:-}" \
      litestream/litestream:0.3.13 restore -o /restore/app.db "${DOCKER_REPLICA_URL}"
  fi
elif [[ -f "${SRC_TARGET}" ]]; then
  echo "    Restoring from filesystem snapshot file: ${SRC_TARGET}..."
  cp "${SRC_TARGET}" "${RESTORED_DB}"
  if [[ -f "${SRC_TARGET}-wal" ]]; then
    cp "${SRC_TARGET}-wal" "${RESTORED_DB}-wal"
  fi
elif [[ -d "${SRC_TARGET}" && -f "${SRC_TARGET}/app.db" ]]; then
  echo "    Restoring from filesystem snapshot directory: ${SRC_TARGET}..."
  cp "${SRC_TARGET}/app.db" "${RESTORED_DB}"
  if [[ -f "${SRC_TARGET}/app.db-wal" ]]; then
    cp "${SRC_TARGET}/app.db-wal" "${RESTORED_DB}-wal"
  fi
else
  echo "ERROR: Source target not recognized or not found: ${SRC_TARGET}" >&2
  exit 1
fi

if [[ ! -f "${RESTORED_DB}" ]]; then
  echo "ERROR: Restored database file does not exist at ${RESTORED_DB}" >&2
  exit 1
fi

echo "    Database restored: $(du -h "${RESTORED_DB}" | cut -f1)"

# 2. Check PRAGMA integrity_check
echo "    Running PRAGMA integrity_check..."
INTEGRITY_OK=0
OS_RESTORED_DB=$(to_os_path "${RESTORED_DB}")

if command -v sqlite3 >/dev/null 2>&1; then
  CHECK_OUT=$(sqlite3 "${RESTORED_DB}" "PRAGMA integrity_check;")
  if [[ "${CHECK_OUT}" == "ok" ]]; then
    INTEGRITY_OK=1
  else
    echo "ERROR: Integrity check failed: ${CHECK_OUT}" >&2
    exit 1
  fi
elif [[ -n "${NODE_CMD}" ]]; then
  CHECK_OUT=$("${NODE_CMD}" -e "
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1], { readonly: true });
    const row = db.pragma('integrity_check');
    console.log(row[0]?.integrity_check || 'fail');
    db.close();
  " "${OS_RESTORED_DB}")
  if [[ "${CHECK_OUT}" == "ok" ]]; then
    INTEGRITY_OK=1
  else
    echo "ERROR: Integrity check failed via Node: ${CHECK_OUT}" >&2
    exit 1
  fi
fi

if [[ ${INTEGRITY_OK} -ne 1 ]]; then
  echo "ERROR: Unable to run integrity check (neither sqlite3 nor node available)" >&2
  exit 1
fi

echo "    Integrity check: OK"

# 3. Check schema: fail when an expected app table is missing, so a wrong
#    database (not the app's) can never print SUCCESS. Also print row counts.
echo "    Checking schema migrations and row counts..."
SCHEMA_CHECK_OUT=""
if [[ -n "${NODE_CMD}" ]]; then
  SCHEMA_CHECK_OUT=$("${NODE_CMD}" -e "
    const Database = require('better-sqlite3');
    const required = ['projects', 'jobs', '__drizzle_migrations'];
    const db = new Database(process.argv[1], { readonly: true });
    const present = new Set(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r => r.name));
    const missing = required.filter(t => !present.has(t));
    if (missing.length) { console.log('MISSING:' + missing.join(',')); process.exit(3); }
    for (const t of required) console.log('ROWS:' + t + '=' + db.prepare('SELECT COUNT(*) AS c FROM \"' + t + '\"').get().c);
    db.close();
  " "${OS_RESTORED_DB}") || SCHEMA_RC=$?
  echo "${SCHEMA_CHECK_OUT}" | sed 's/^/    /'
  if [[ "${SCHEMA_RC:-0}" -ne 0 ]]; then
    echo "ERROR: Restored database is not the app schema (required tables missing)." >&2
    exit 1
  fi
elif command -v sqlite3 >/dev/null 2>&1; then
  for t in projects jobs __drizzle_migrations; do
    if [[ -z "$(sqlite3 "${RESTORED_DB}" "SELECT name FROM sqlite_master WHERE type='table' AND name='${t}';")" ]]; then
      echo "ERROR: Restored database is missing table ${t}." >&2
      exit 1
    fi
  done
  echo "    Schema tables present"
else
  echo "ERROR: Neither node nor sqlite3 available to check schema." >&2
  exit 1
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
echo "==> RESTORE DRILL SUCCESSFUL (Duration: ${DURATION}s)"
exit 0
