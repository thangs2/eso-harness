#!/usr/bin/env bash
# Shared helpers for the ESO deploy scripts. Source this file; do not execute it.
set -euo pipefail

# Resolve the repository root from this file: deploy/bin/lib.sh -> repo root.
_lib_source="${BASH_SOURCE[0]}"
_lib_bin_dir="$(cd -- "$(dirname -- "$_lib_source")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "$_lib_bin_dir/../.." >/dev/null 2>&1 && pwd)"
if _lib_git_root="$(git -C "$ROOT_DIR" rev-parse --show-toplevel 2>/dev/null)"; then
    ROOT_DIR="$_lib_git_root"
fi
unset _lib_source _lib_bin_dir _lib_git_root

export ROOT_DIR
export DOCKER_CONFIG="${DOCKER_CONFIG:-$ROOT_DIR/.docker-config}"

ESO_ENV="${ESO_ENV:-dev}"
ESO_PROJECT="${ESO_PROJECT:-eso}"
ESO_HEALTH_TIMEOUT="${ESO_HEALTH_TIMEOUT:-120}"
ESO_LOG_TAIL="${ESO_LOG_TAIL:-200}"
ESO_BACKUP_KEEP="${ESO_BACKUP_KEEP:-14}"
export ESO_PROJECT ESO_HEALTH_TIMEOUT ESO_LOG_TAIL ESO_BACKUP_KEEP

STATE_DIR="$ROOT_DIR/deploy/.state"
BACKUP_DIR="$ROOT_DIR/deploy/backups"
LOG_DIR="$ROOT_DIR/deploy/logs"
export STATE_DIR BACKUP_DIR LOG_DIR
ENV_FILE=""
COMPOSE_FILE=""

info() {
    printf '[eso] %s\n' "$*"
}

warn() {
    printf '[eso] WARN: %s\n' "$*" >&2
}

die() {
    printf '[eso] ERROR: %s\n' "$*" >&2
    exit 1
}

require_cmd() {
    local cmd
    for cmd in "$@"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            die "required command not found: $cmd"
        fi
    done
}

validate_env() {
    case "${1:-}" in
        dev | staging | prod) return 0 ;;
        *) die "invalid ESO_ENV '${1:-}' (expected dev, staging, or prod)" ;;
    esac
}

set_env() {
    local env_name="${1:-${ESO_ENV:-dev}}"
    validate_env "$env_name"
    ESO_ENV="$env_name"
    export ESO_ENV

    case "$ESO_ENV" in
        dev) COMPOSE_FILE="$ROOT_DIR/deploy/compose/compose.dev.yml" ;;
        staging | prod) COMPOSE_FILE="$ROOT_DIR/deploy/compose/compose.prod.yml" ;;
    esac
    ENV_FILE="$ROOT_DIR/deploy/env/$ESO_ENV.env"
    export COMPOSE_FILE ENV_FILE
}

compose() {
    mkdir -p "$DOCKER_CONFIG"
    if [[ -z "$COMPOSE_FILE" ]]; then
        die "COMPOSE_FILE is not set; call set_env first"
    fi
    if [[ -z "$ENV_FILE" ]]; then
        die "ENV_FILE is not set; call set_env first"
    fi
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        die "compose file not found: $COMPOSE_FILE"
    fi
    if [[ ! -f "$ENV_FILE" ]]; then
        die "env file not found: $ENV_FILE (run deploy/bin/env-init.sh --env $ESO_ENV)"
    fi
    docker compose --project-name "$ESO_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

load_env() {
    if [[ -z "$ENV_FILE" ]]; then
        die "ENV_FILE is not set; call set_env first"
    fi
    if [[ ! -f "$ENV_FILE" ]]; then
        die "env file not found: $ENV_FILE (run deploy/bin/env-init.sh --env $ESO_ENV)"
    fi

    local requested_env="$ESO_ENV"
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    ESO_ENV="$requested_env"
    export ESO_ENV

    ESO_HEALTH_TIMEOUT="${ESO_HEALTH_TIMEOUT:-120}"
    ESO_LOG_TAIL="${ESO_LOG_TAIL:-200}"
    ESO_BACKUP_KEEP="${ESO_BACKUP_KEEP:-14}"
    export ESO_HEALTH_TIMEOUT ESO_LOG_TAIL ESO_BACKUP_KEEP
}

require_vars() {
    local key
    local missing=""
    for key in "$@"; do
        if [[ -z "${!key:-}" ]]; then
            missing="${missing}${missing:+, }$key"
        fi
    done
    if [[ -n "$missing" ]]; then
        die "missing required variables in $ENV_FILE: $missing"
    fi
}

api_url() {
    printf 'http://127.0.0.1:%s\n' "${ESO_API_PORT:-8787}"
}

ui_url() {
    printf 'http://127.0.0.1:%s\n' "${ESO_UI_PORT:-4200}"
}

wait_healthy() {
    local timeout="${ESO_HEALTH_TIMEOUT:-120}"
    local waited=0
    local api_base
    local ui_base
    local api_body
    local ui_body

    if ! [[ "$timeout" =~ ^[0-9]+$ ]]; then
        die "ESO_HEALTH_TIMEOUT must be an integer (got '$timeout')"
    fi

    require_cmd curl
    api_base="$(api_url)"
    ui_base="$(ui_url)"
    info "waiting up to ${timeout}s for ${api_base}/health and ${ui_base}/healthz"

    while [[ "$waited" -lt "$timeout" ]]; do
        api_body="$(curl -fsS --max-time 3 "${api_base}/health" 2>/dev/null || true)"
        ui_body="$(curl -fsS --max-time 3 "${ui_base}/healthz" 2>/dev/null || true)"
        if printf '%s' "$api_body" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"' &&
            printf '%s' "$ui_body" | grep -Eq '(^|[[:space:]])ok([[:space:]]|$)'; then
            info "services are healthy"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    warn "health check timed out after ${timeout}s (api=${api_base}/health ui=${ui_base}/healthz)"
    return 1
}

state_write() {
    local tag="${1:-${ESO_IMAGE_TAG:-}}"
    local env_name="${2:-${ESO_ENV:-dev}}"
    if [[ -z "$tag" ]]; then
        die "state_write requires an image tag"
    fi
    mkdir -p "$STATE_DIR"
    if [[ -f "$STATE_DIR/current.env" ]]; then
        cp "$STATE_DIR/current.env" "$STATE_DIR/previous.env"
    fi
    {
        printf 'ESO_IMAGE_TAG=%s\n' "$tag"
        printf 'ESO_ENV=%s\n' "$env_name"
        printf 'ESO_DEPLOYED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    } >"$STATE_DIR/current.env.tmp"
    mv "$STATE_DIR/current.env.tmp" "$STATE_DIR/current.env"
}

state_read() {
    local key="${1:-}"
    local file="${2:-$STATE_DIR/current.env}"
    if [[ ! -f "$file" ]]; then
        return 1
    fi
    if [[ -z "$key" ]]; then
        cat "$file"
        return 0
    fi
    local line
    line="$(grep -E "^${key}=" "$file" | tail -n 1)" || return 1
    printf '%s\n' "${line#*=}"
}

confirm() {
    local prompt="${1:-Continue?}"
    local answer=""
    if [[ "${ESO_ASSUME_YES:-0}" == "1" ]]; then
        return 0
    fi
    if [[ ! -t 0 ]]; then
        warn "no TTY available for confirmation; pass --yes to continue"
        return 1
    fi
    read -r -p "$prompt [y/N] " answer
    case "$answer" in
        y | Y | yes | YES) return 0 ;;
        *) return 1 ;;
    esac
}
