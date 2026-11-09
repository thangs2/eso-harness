#!/usr/bin/env bash
# Open a shell in the ui container.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
exec "$SCRIPT_DIR/../shared/shell.sh" "$@" ui
