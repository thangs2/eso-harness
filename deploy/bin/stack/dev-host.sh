#!/usr/bin/env bash
# Run the control-plane and the UI as HOST processes (no compose), for local development.
#
#   bash deploy/bin/stack/dev-host.sh                 # postgres (compose) + CP 8787 + UI 4200
#   bash deploy/bin/stack/dev-host.sh --no-db         # assume PostgreSQL is already reachable
#   bash deploy/bin/stack/dev-host.sh --dry-run       # print the commands, start nothing
#
# Ctrl-C stops both child processes. Logs: /tmp/eso-cp.log · /tmp/eso-ui.log
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." >/dev/null 2>&1 && pwd)"

CP_PORT="${ESO_API_PORT:-8787}"
UI_PORT="${ESO_UI_PORT:-4200}"
DB_PORT="${ESO_DB_PORT:-55432}"
DB_URL="${ESO_DB_URL:-postgres://eso:eso-dev-only-password@127.0.0.1:${DB_PORT}/eso}"
AUTH_USER="${ESO_AUTH_USER:-operator}"
AUTH_PASSWORD="${ESO_AUTH_PASSWORD:-eso-dev-only-token}"
API_TOKEN="${ESO_API_TOKEN:-$AUTH_PASSWORD}"
AUTH_PROJECT="${ESO_AUTH_PROJECT:-eso}"
FS_ROOT="${ESO_FS_ROOT:-$HOME}"
NO_DB=0
DRY_RUN=0

usage() {
    sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-db) NO_DB=1 ;;
        --dry-run) DRY_RUN=1 ;;
        -h | --help) usage; exit 0 ;;
        *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

if [[ ! -d "$REPO_ROOT/eso/control-plane" || ! -d "$REPO_ROOT/eso/ui" ]]; then
    echo "error: run from the eso-harness repo (looked at $REPO_ROOT)" >&2
    exit 2
fi

start_db() {
    if [[ "$NO_DB" -eq 1 ]]; then echo "db: skipped (--no-db)"; return 0; fi
    if ! command -v docker >/dev/null 2>&1; then
        echo "db: docker not found; assuming PostgreSQL at $DB_URL" >&2
        return 0
    fi
    if docker compose -f "$REPO_ROOT/deploy/compose/compose.dev.yml" ps postgres 2>/dev/null | grep -q 'running'; then
        echo "db: postgres already running"
        return 0
    fi
    echo "db: starting postgres on 127.0.0.1:${DB_PORT} via compose"
    ( cd "$REPO_ROOT" && ESO_DB_PORT="$DB_PORT" ESO_DB_PASSWORD="${ESO_DB_PASSWORD:-eso-dev-only-password}" \
        COMPOSE_PROJECT_NAME=eso docker compose -f deploy/compose/compose.dev.yml up -d postgres ) >/dev/null
}

wait_http() {
    local url="$1" name="$2" tries=60
    for ((i = 1; i <= tries; i++)); do
        if curl -fsS -o /dev/null "$url" 2>/dev/null; then
            echo "$name: ready $url"
            return 0
        fi
        sleep 1
    done
    echo "$name: NOT ready after ${tries}s — see logs" >&2
    return 1
}

if [[ "$DRY_RUN" -eq 1 ]]; then
    cat <<DRY_EOF
cd "$REPO_ROOT/eso/control-plane" && \\
  ESO_DB_URL='$DB_URL' ESO_PORT=$CP_PORT \\
  ESO_AUTH_USER='$AUTH_USER' ESO_AUTH_PASSWORD='$AUTH_PASSWORD' \\
  ESO_API_TOKEN='$API_TOKEN' ESO_AUTH_PROJECT='$AUTH_PROJECT' ESO_FS_ROOT='$FS_ROOT' \\
  bun src/common/http/server.ts

cd "$REPO_ROOT/eso/ui" && bun run serve   # port $UI_PORT
DRY_EOF
    exit 0
fi

start_db

CP_LOG=/tmp/eso-cp.log
UI_LOG=/tmp/eso-ui.log
CP_PID=""
UI_PID=""

cleanup() {
    trap - EXIT INT TERM
    if [[ -n "$CP_PID" ]]; then kill "$CP_PID" 2>/dev/null || true; fi
    if [[ -n "$UI_PID" ]]; then kill "$UI_PID" 2>/dev/null || true; fi
    wait 2>/dev/null || true
    echo
    echo "stopped. logs: $CP_LOG · $UI_LOG"
}
trap cleanup EXIT INT TERM

(
    cd "$REPO_ROOT/eso/control-plane"
    ESO_DB_URL="$DB_URL" ESO_PORT="$CP_PORT" \
    ESO_AUTH_USER="$AUTH_USER" ESO_AUTH_PASSWORD="$AUTH_PASSWORD" \
    ESO_API_TOKEN="$API_TOKEN" ESO_AUTH_PROJECT="$AUTH_PROJECT" \
    ESO_FS_ROOT="$FS_ROOT" \
    exec bun src/common/http/server.ts
) >"$CP_LOG" 2>&1 &
CP_PID=$!

(
    cd "$REPO_ROOT/eso/ui"
    exec bun run serve
) >"$UI_LOG" 2>&1 &
UI_PID=$!

wait_http "http://127.0.0.1:${CP_PORT}/health" "control-plane"
wait_http "http://127.0.0.1:${UI_PORT}/" "ui"

cat <<BANNER

  control plane  http://127.0.0.1:${CP_PORT}
  ui             http://127.0.0.1:${UI_PORT}
  login          ${AUTH_USER} / ${AUTH_PASSWORD}
  logs           ${CP_LOG} · ${UI_LOG}

  Ctrl-C to stop both.

BANNER

wait "$CP_PID" "$UI_PID" 2>/dev/null || true
