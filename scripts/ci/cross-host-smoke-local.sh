#!/usr/bin/env bash
# Repeatable local cross-host smoke. Secrets live in ~/.eso/cross-host-smoke.env (mode 600).
set -euo pipefail
ROOT="/Users/thangs2net/Workspaces/eso-harness"
ENV_FILE="${ESO_SMOKE_ENV:-$HOME/.eso/cross-host-smoke.env}"
LOG_DIR="$HOME/.eso/logs"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/cross-host-smoke.log" 2>&1
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) cross-host smoke =="
if [[ ! -f "$ENV_FILE" ]]; then echo "missing $ENV_FILE"; exit 2; fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
PORT="${ESO_SMOKE_PORT:-8790}"
BASE="${ESO_BASE_URL:-http://127.0.0.1:8787}"
WORKSPACE="${ESO_WORKSPACE_REPO:?ESO_WORKSPACE_REPO is required}"
CONSUMER="${ESO_CONSUMER:?ESO_CONSUMER is required}"
FLOW="${ESO_FLOW:?ESO_FLOW is required}"
RUNTIME="${ESO_RUNTIME_KEY:?ESO_RUNTIME_KEY is required}"
BUN="/opt/homebrew/bin/bun"
TOKEN_JSON="$(curl -sf -X POST -H "Authorization: Basic $(printf 'operator:%s' "$ESO_OPERATOR_TOKEN" | base64)" -H 'Content-Type: application/json' -d "{\"consumerId\":\"$CONSUMER\"}" "$BASE/api/v1/hosts/agy/runtimes/agy/tokens")"
TOKEN_ID="$(printf '%s' "$TOKEN_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tokenId"])')"
TOKEN="$(printf '%s' "$TOKEN_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')"
PID=""
cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  curl -sf -o /dev/null -X DELETE -H "Authorization: Basic $(printf 'operator:%s' "$ESO_OPERATOR_TOKEN" | base64)" "$BASE/api/v1/hosts/agy/runtimes/agy/tokens/$TOKEN_ID" || true
}
trap cleanup EXIT
cd "$ROOT/host-runtime"
ESO_BASE_URL="$BASE" ESO_CONSUMER="$CONSUMER" ESO_RUNTIME_KEY="agy:agy" ESO_HOST_TOKEN="$TOKEN" \
  ESO_REMOTE_TOKEN="$ESO_REMOTE_TOKEN" ESO_REMOTE_ALLOWED_WS="$WORKSPACE" \
  "$BUN" src/server.ts serve --runtime-key 'agy:agy' --host 127.0.0.1 --port "$PORT" \
  --allowed-workspace "$WORKSPACE" --ledger-path "$HOME/.eso/cross-host-ledger.json" >/tmp/cross-host-b.log 2>&1 &
PID=$!
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.3
done
cd "$ROOT"
ESO_OPERATOR_TOKEN="$ESO_OPERATOR_TOKEN" ESO_BASE_URL="$BASE" ESO_CONSUMER="$CONSUMER" \
  ESO_FLOW="$FLOW" ESO_PROMPT='Scheduled cross-host smoke. Do not edit files. Reply: SMOKE_OK' \
  ESO_RUNTIME_KEY="$RUNTIME" ESO_REMOTE_TOKEN="$ESO_REMOTE_TOKEN" \
  ESO_REMOTE_HOSTS="{\"agy:agy\":\"http://127.0.0.1:$PORT\"}" ESO_WORKSPACE_REPO="$WORKSPACE" \
  ESO_ADAPTER=dry ESO_DRY=1 ESO_MAX_STEPS=12 node scripts/ci/cross-host-smoke.mjs
