#!/usr/bin/env bash
# Deploy the compose stack for an environment.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: deploy.sh [ENV] [--env dev|staging|prod] [--pull] [-h|--help]

Builds the images (unless --pull), starts the stack with
docker compose up -d --remove-orphans, waits for health, then records the
deployed tag as deploy/.state/current.env (rotating previous.env).

ENV may be passed positionally (dev, staging, prod) or with --env.

Options:
  --env NAME   Target environment (default: dev).
  --pull       Pull the control-plane and UI images instead of building.
  -h, --help   Show this help and exit.
EOF
}

PULL=0
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
        dev | staging | prod)
            if [[ "$ENV_GIVEN" -eq 1 ]]; then
                warn "environment specified more than once"
                usage >&2
                exit 2
            fi
            ESO_ENV="$1"
            ENV_GIVEN=1
            shift
            ;;
        --pull)
            PULL=1
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

require_vars ESO_DB_NAME ESO_DB_USER ESO_DB_PASSWORD ESO_AUTH_TOKEN ESO_AUTH_PROJECT
if [[ "$ESO_ENV" == "staging" || "$ESO_ENV" == "prod" ]]; then
    require_vars ESO_REGISTRY ESO_IMAGE_TAG
else
    ESO_IMAGE_TAG="${ESO_IMAGE_TAG:-dev}"
fi
export ESO_IMAGE_TAG

if [[ "$PULL" -eq 1 ]]; then
    info "pulling images for $ESO_ENV (tag $ESO_IMAGE_TAG)"
    compose pull control-plane ui
else
    info "building images for $ESO_ENV (tag $ESO_IMAGE_TAG)"
    "$SCRIPT_DIR/../shared/build.sh" --env "$ESO_ENV"
fi

compose up -d --remove-orphans
wait_healthy
state_write "$ESO_IMAGE_TAG" "$ESO_ENV"

info "deployed $ESO_ENV with image tag $ESO_IMAGE_TAG"
info "API: $(api_url)"
info "UI:  $(ui_url)"
