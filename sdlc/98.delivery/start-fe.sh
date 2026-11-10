#!/usr/bin/env bash
# FE demo — eso/ui (Angular build + structure + AC tests). Stable entrypoint; batch is an argument.
# Usage: start-fe.sh [--batch=YYYY-MM-DD-eso-X-Y]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BATCH=""
for arg in "$@"; do
  case "$arg" in
    --batch=*) BATCH="${arg#*=}" ;;
    -h|--help) echo "usage: $0 [--batch=YYYY-MM-DD-eso-X-Y]"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if [ -z "$BATCH" ]; then
  BATCH="$(ls -1 "$ROOT/sdlc/98.delivery/demo" | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}-' | sort | tail -1)"
fi
if [ ! -f "$ROOT/sdlc/98.delivery/demo/$BATCH/00.index.md" ]; then
  echo "unknown demo batch: $BATCH" >&2
  exit 2
fi
echo "[start-fe] batch=$BATCH"
echo "[fe] build eso/ui"
(cd "$ROOT/eso/ui" && npm run build)
echo "[fe] real Angular build (AOT)"
(cd "$ROOT/eso/ui" && npm run build:ng)
echo "[fe] structure check"
node "$ROOT/eso/ui/scripts/check-structure.mjs"
echo "[fe] AC tests"
(cd "$ROOT" && bun test qc/eso-ui-*.test.mjs)
echo "[fe] PASS"
