#!/usr/bin/env bash
# Restore a pg_dump archive into the postgres container.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: restore.sh [ENV] [--env dev|staging|prod] [--yes] DUMP [-h|--help]

Stops control-plane and ui, runs pg_restore --clean --if-exists --no-owner
against the postgres container, then starts the services and waits for health.
Services are restarted if the restore or the health check fails.

ENV may be passed positionally (dev, staging, prod) before DUMP, or with --env.

Options:
  --env NAME   Target environment (default: dev).
  --yes        Skip the interactive confirmation.
  -h, --help   Show this help and exit.
EOF
}

DUMP=""
YES=0
ENV_GIVEN=0
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
            ENV_GIVEN=1
            shift 2
            ;;
        --env=*)
            ESO_ENV="${1#*=}"
            ENV_GIVEN=1
            shift
            ;;
        --yes)
            YES=1
            shift
            ;;
        dev | staging | prod)
            if [[ "$ENV_GIVEN" -eq 0 && -z "$DUMP" ]]; then
                ESO_ENV="$1"
                ENV_GIVEN=1
                shift
            elif [[ -z "$DUMP" ]]; then
                DUMP="$1"
                shift
            else
                warn "unexpected argument: $1"
                usage >&2
                exit 2
            fi
            ;;
        -*)
            warn "unknown option: $1"
            usage >&2
            exit 2
            ;;
        *)
            if [[ -n "$DUMP" ]]; then
                warn "unexpected argument: $1"
                usage >&2
                exit 2
            fi
            DUMP="$1"
            shift
            ;;
    esac
done

if [[ -z "$DUMP" ]]; then
    warn "a dump file is required"
    usage >&2
    exit 2
fi
if [[ ! -f "$DUMP" ]]; then
    die "dump file not found: $DUMP"
fi
if [[ ! -s "$DUMP" ]]; then
    die "dump file is empty: $DUMP"
fi

set_env "$ESO_ENV"
load_env
require_cmd docker curl
require_vars ESO_DB_USER ESO_DB_NAME

if [[ "$YES" -ne 1 ]]; then
    if ! confirm "Restore $DUMP into $ESO_ENV database $ESO_DB_NAME?"; then
        die "restore cancelled"
    fi
fi

info "stopping control-plane and ui"
compose stop control-plane ui

info "restoring $DUMP into database $ESO_DB_NAME"
if ! compose exec -T postgres pg_restore -U "$ESO_DB_USER" -d "$ESO_DB_NAME" --clean --if-exists --no-owner <"$DUMP"; then
    warn "pg_restore failed; restarting services"
    compose up -d --remove-orphans || warn "failed to restart services"
    exit 1
fi

if ! compose up -d --remove-orphans; then
    warn "restore completed but services failed to start"
    exit 1
fi

if ! wait_healthy; then
    warn "services are unhealthy after restore; recreating the stack"
    compose up -d --force-recreate --remove-orphans || warn "failed to recreate services"
    if ! wait_healthy; then
        warn "services are still unhealthy after restore"
        exit 1
    fi
fi

info "restore complete"
info "API: $(api_url)"
info "UI:  $(ui_url)"
