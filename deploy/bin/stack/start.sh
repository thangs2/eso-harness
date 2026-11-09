#!/usr/bin/env bash
# Start the compose stack and wait for the API and UI to become healthy.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: start.sh [--env dev|staging|prod] [-h|--help]

Starts the compose stack (docker compose up -d --remove-orphans) and waits for
the control-plane /health and UI /healthz endpoints.

Options:
  --env NAME   Target environment (default: dev).
  -h, --help   Show this help and exit.
EOF
}

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

compose up -d --remove-orphans
wait_healthy

info "API: $(api_url)"
info "UI:  $(ui_url)"
