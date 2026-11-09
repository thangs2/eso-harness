#!/usr/bin/env bash
# Follow compose logs, optionally for one service.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: logs.sh [--env dev|staging|prod] [--tail N] [SERVICE] [EXTRA...] [-h|--help]

Follows compose logs with --tail from ESO_LOG_TAIL (default 200). A service
name is optional; everything after it is passed through to docker compose logs
(for example: logs.sh control-plane --since 10m).

Options:
  --env NAME   Target environment (default: dev).
  --tail N     Number of lines to show (overrides ESO_LOG_TAIL).
  -h, --help   Show this help and exit.
EOF
}

TAIL=""
SERVICE=""
EXTRA=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h | --help)
            usage
            exit 0
            ;;
    esac
    if [[ -n "$SERVICE" ]]; then
        EXTRA+=("$1")
        shift
        continue
    fi
    case "$1" in
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
        --tail)
            if [[ $# -lt 2 ]]; then
                warn "--tail requires a value"
                usage >&2
                exit 2
            fi
            TAIL="$2"
            shift 2
            ;;
        --tail=*)
            TAIL="${1#*=}"
            shift
            ;;
        --)
            shift
            while [[ $# -gt 0 ]]; do
                EXTRA+=("$1")
                shift
            done
            ;;
        -*)
            warn "unknown option: $1"
            usage >&2
            exit 2
            ;;
        *)
            SERVICE="$1"
            shift
            ;;
    esac
done

set_env "$ESO_ENV"
load_env
require_cmd docker

TAIL="${TAIL:-${ESO_LOG_TAIL:-200}}"
if ! [[ "$TAIL" =~ ^[0-9]+$ ]]; then
    die "--tail must be a non-negative integer (got '$TAIL')"
fi

if [[ ${#EXTRA[@]} -gt 0 ]]; then
    if [[ -n "$SERVICE" ]]; then
        compose logs -f --tail="$TAIL" "${EXTRA[@]}" "$SERVICE"
    else
        compose logs -f --tail="$TAIL" "${EXTRA[@]}"
    fi
elif [[ -n "$SERVICE" ]]; then
    compose logs -f --tail="$TAIL" "$SERVICE"
else
    compose logs -f --tail="$TAIL"
fi
