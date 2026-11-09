#!/usr/bin/env bash
# Stop the compose stack. Volumes are kept unless --volumes is passed.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: stop.sh [--env dev|staging|prod] [--volumes] [-h|--help]

Stops the compose stack. Volumes are preserved by default.

Options:
  --env NAME   Target environment (default: dev).
  --volumes    Also remove named volumes (docker compose down -v).
  -h, --help   Show this help and exit.
EOF
}

VOLUMES=0
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
        --volumes)
            VOLUMES=1
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
require_cmd docker

if [[ "$VOLUMES" -eq 1 ]]; then
    compose down -v
else
    compose down
fi

info "stopped environment $ESO_ENV"
