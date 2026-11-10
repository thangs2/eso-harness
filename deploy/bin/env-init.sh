#!/usr/bin/env bash
# Prepare a local runtime environment file and the deploy state directories.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

usage() {
    cat <<'EOF'
Usage: env-init.sh [--env dev|staging|prod] [--force] [-h|--help]

Creates deploy/env/<env>.env from deploy/env/<env>.env.example when missing,
creates the state/backup/log directories, and validates the required keys.

Options:
  --env NAME   Target environment (default: dev).
  --force      Replace an existing runtime env file with the template.
  -h, --help   Show this help and exit.
EOF
}

FORCE=0
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
        --force)
            FORCE=1
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
require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
    die "docker compose is not available"
fi

example_file="$ROOT_DIR/deploy/env/${ESO_ENV}.env.example"
if [[ ! -f "$example_file" ]]; then
    die "env template not found: $example_file"
fi

mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$LOG_DIR" "$(dirname "$ENV_FILE")"

if [[ -f "$ENV_FILE" && "$FORCE" -ne 1 ]]; then
    info "runtime env already exists: $ENV_FILE"
else
    cp "$example_file" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    info "created runtime env: $ENV_FILE"
fi

load_env

required_vars=(ESO_IMAGE_TAG ESO_DB_NAME ESO_DB_USER ESO_DB_PASSWORD ESO_AUTH_TOKEN ESO_AUTH_PROJECT)
if [[ "$ESO_ENV" == "staging" || "$ESO_ENV" == "prod" ]]; then
    required_vars+=(ESO_REGISTRY)
fi
require_vars "${required_vars[@]}"

if grep -Eqi 'change[-_]?me|replace[-_]?me' "$ENV_FILE"; then
    warn "placeholder values remain in $ENV_FILE; replace them before a real deployment"
fi

info "environment $ESO_ENV is ready"
info "next: deploy/bin/shared/build.sh --env $ESO_ENV"
