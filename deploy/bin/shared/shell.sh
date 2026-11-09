#!/usr/bin/env bash
# Open an interactive shell in a compose service (control-plane or ui).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'USAGE'
Usage: shell.sh [--env dev|staging|prod] [control-plane|ui] [-h|--help]

Opens a shell inside the named service container.

Options:
  --env NAME   Target environment (default: dev).
  -h, --help   Show this help and exit.
USAGE
}

SERVICE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h | --help) usage; exit 0 ;;
        --env)
            [[ $# -ge 2 ]] || { warn "--env requires a value"; exit 2; }
            ESO_ENV="$2"; shift 2 ;;
        --env=*) ESO_ENV="${1#*=}"; shift ;;
        control-plane | ui) SERVICE="$1"; shift ;;
        -*) warn "unknown option: $1"; usage >&2; exit 2 ;;
        *) warn "unexpected argument: $1"; usage >&2; exit 2 ;;
    esac
done

[[ -n "$SERVICE" ]] || { warn "service is required: control-plane|ui"; usage >&2; exit 2; }
set_env "$ESO_ENV"
load_env
require_cmd docker
compose exec "$SERVICE" sh
