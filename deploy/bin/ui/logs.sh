#!/usr/bin/env bash
# Follow logs for the ui service.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
exec "$SCRIPT_DIR/../shared/logs.sh" "$@" ui
