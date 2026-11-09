#!/usr/bin/env bash
# Report compose service state and probe the API and UI health endpoints.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: status.sh [--env dev|staging|prod] [-h|--help]

Prints a compose service table and probes GET /health on the API and
GET /healthz on the UI. Exits 0 only when all services are running and both
endpoints return HTTP 200.

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

info "compose project: $ESO_PROJECT (environment: $ESO_ENV)"
compose ps || warn "could not read compose service status"

running_services="$(compose ps --services --status running 2>/dev/null || true)"

all_running=1
printf '\n%-16s %-10s %s\n' "SERVICE" "STATE" "DETAIL"
printf '%-16s %-10s %s\n' "----------------" "----------" "------------------------------"
for service in postgres control-plane ui; do
    if printf '%s\n' "$running_services" | grep -qx "$service"; then
        state="running"
        detail="compose service"
    else
        state="stopped"
        detail="compose service"
        all_running=0
    fi
    printf '%-16s %-10s %s\n' "$service" "$state" "$detail"
done

api_base="$(api_url)"
ui_base="$(ui_url)"
api_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$api_base/health" 2>/dev/null || true)"
ui_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$ui_base/healthz" 2>/dev/null || true)"
api_code="${api_code:-000}"
ui_code="${ui_code:-000}"

api_ok=0
ui_ok=0
if [[ "$api_code" == "200" ]]; then
    api_ok=1
fi
if [[ "$ui_code" == "200" ]]; then
    ui_ok=1
fi

api_state="down"
ui_state="down"
if [[ "$api_ok" -eq 1 ]]; then
    api_state="up"
fi
if [[ "$ui_ok" -eq 1 ]]; then
    ui_state="up"
fi

printf '%-16s %-10s %s\n' "API" "$api_state" "GET $api_base/health -> HTTP $api_code"
printf '%-16s %-10s %s\n' "UI" "$ui_state" "GET $ui_base/healthz -> HTTP $ui_code"

if [[ "$all_running" -eq 1 && "$api_ok" -eq 1 && "$ui_ok" -eq 1 ]]; then
    info "status: healthy"
    exit 0
fi

warn "status: unhealthy (services_running=$all_running api_200=$api_ok ui_200=$ui_ok)"
exit 1
