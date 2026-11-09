#!/usr/bin/env bash
# Build the control-plane image.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
exec "$SCRIPT_DIR/../shared/build.sh" "$@" control-plane
