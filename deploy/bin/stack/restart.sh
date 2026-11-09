#!/usr/bin/env bash
# Restart the compose stack, optionally rebuilding images first.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: restart.sh [--env dev|staging|prod] [--build] [-h|--help]

Restarts the compose stack and waits for health. With --build, images are
rebuilt first and the stack is stopped before being started again.

Options:
  --env NAME   Target environment (default: dev).
  --build      Build images, then stop and start the stack.
  -h, --help   Show this help and exit.
EOF
}

BUILD=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h | --help)
            usage
            exit 0
            ;;
        --env)
            if [[ $# -lt 2 ]]; then
                warn "--env requires a value"
                usage >&2
                exit 2
            fi
            ESO_ENV="$2"
            shift 2
            ;;
        --env=*)
            ESO_ENV="${1#*=}"
            shift
            ;;
        --build)
            BUILD=1
            shift
            ;;
        -*)
            warn "unknown option: $1"
            usage >&2
            exit 2
            ;;
        *)
            warn "unexpected argument: $1"
            usage >&2
            exit 2
            ;;
    esac
done

set_env "$ESO_ENV"
load_env
require_cmd docker curl

if [[ "$BUILD" -eq 1 ]]; then
    if [[ "$ESO_ENV" != "dev" ]]; then
        [[ -n "${ESO_REGISTRY:-}" ]] || die "ESO_REGISTRY is required for --build in $ESO_ENV"
        [[ -n "${ESO_IMAGE_TAG:-}" ]] || die "ESO_IMAGE_TAG is required for --build in $ESO_ENV"
    fi
    "$SCRIPT_DIR/../shared/build.sh" --env "$ESO_ENV"
    "$SCRIPT_DIR/stop.sh" --env "$ESO_ENV"
    "$SCRIPT_DIR/start.sh" --env "$ESO_ENV"
else
    compose restart
    wait_healthy
    info "restarted environment $ESO_ENV"
fi
