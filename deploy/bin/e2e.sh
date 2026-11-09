#!/usr/bin/env bash
# Run the end-to-end smoke stack and preserve its exit code.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

usage() {
    cat <<'EOF'
Usage: e2e.sh [--keep] [-h|--help]

Runs docker compose with deploy/compose/compose.e2e.yml and
deploy/env/dev.env.example under project eso-e2e:

  up --build --abort-on-container-exit --exit-code-from smoke

The stack is removed with down -v afterwards. On failure the output is kept at
deploy/logs/e2e-<timestamp>.log. --keep leaves the stack running for inspection.

Options:
  --keep       Do not run docker compose down -v after the run.
  -h, --help   Show this help and exit.
EOF
}

KEEP=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h | --help)
            usage
            exit 0
            ;;
        --keep)
            KEEP=1
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

ESO_ENV="dev"
set_env "$ESO_ENV"
COMPOSE_FILE="$ROOT_DIR/deploy/compose/compose.e2e.yml"
ENV_FILE="$ROOT_DIR/deploy/env/dev.env.example"
ESO_PROJECT="eso-e2e"
export COMPOSE_FILE ENV_FILE ESO_PROJECT

if [[ ! -f "$COMPOSE_FILE" ]]; then
    die "compose file not found: $COMPOSE_FILE"
fi
if [[ ! -f "$ENV_FILE" ]]; then
    die "env example not found: $ENV_FILE"
fi

load_env
require_cmd docker
mkdir -p "$LOG_DIR"

log_file="$LOG_DIR/e2e-$(date -u +%Y%m%dT%H%M%SZ).log"
printf '[eso] e2e run started at %s (project %s)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ESO_PROJECT" >"$log_file"

cleanup() {
    local rc=$?
    trap - EXIT
    if [[ "$rc" -ne 0 ]]; then
        info "e2e failed (exit $rc); log: $log_file"
    else
        rm -f "$log_file"
    fi
    if [[ "$KEEP" -eq 1 ]]; then
        info "keeping e2e stack (--keep)"
    else
        info "cleaning up e2e stack"
        compose down -v >/dev/null 2>&1 || warn "e2e cleanup failed"
    fi
    exit "$rc"
}
trap cleanup EXIT

info "running e2e stack (project $ESO_PROJECT)"
compose up --build --abort-on-container-exit --exit-code-from smoke 2>&1 | tee -a "$log_file"
rc=${PIPESTATUS[0]}
exit "$rc"
