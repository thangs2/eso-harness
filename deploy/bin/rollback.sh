#!/usr/bin/env bash
# Roll back to a previous image tag and wait for the stack to become healthy.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

usage() {
    cat <<'EOF'
Usage: rollback.sh [ENV] [--env dev|staging|prod] [--to TAG] [-h|--help]

Rolls the stack back to TAG, or to ESO_IMAGE_TAG from
deploy/.state/previous.env when --to is omitted. The compose up runs with
ESO_IMAGE_TAG overridden to the rollback tag, then health is checked and the
new state is recorded.

ENV may be passed positionally (dev, staging, prod) or with --env.

Options:
  --env NAME   Target environment (default: state file, else dev).
  --to TAG     Image tag to roll back to.
  -h, --help   Show this help and exit.
EOF
}

TO_TAG=""
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
        --to)
            if [[ $# -lt 2 ]]; then
                warn "--to requires a value"
                usage >&2
                exit 2
            fi
            TO_TAG="$2"
            shift 2
            ;;
        --to=*)
            TO_TAG="${1#*=}"
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

if [[ "$ENV_GIVEN" -eq 0 ]]; then
    state_env="$(state_read ESO_ENV 2>/dev/null || true)"
    if [[ -n "$state_env" ]]; then
        ESO_ENV="$state_env"
    fi
fi

set_env "$ESO_ENV"
load_env
require_cmd docker curl

if [[ -z "$TO_TAG" ]]; then
    TO_TAG="$(state_read ESO_IMAGE_TAG "$STATE_DIR/previous.env" 2>/dev/null || true)"
fi
if [[ -z "$TO_TAG" ]]; then
    die "no rollback tag available: pass --to TAG or deploy at least twice so previous.env exists"
fi

if [[ "$ESO_ENV" == "staging" || "$ESO_ENV" == "prod" ]]; then
    require_vars ESO_REGISTRY
fi

export ESO_IMAGE_TAG="$TO_TAG"
info "rolling back $ESO_ENV to image tag $TO_TAG"
compose up -d --remove-orphans
wait_healthy
state_write "$TO_TAG" "$ESO_ENV"

info "rollback complete: $ESO_ENV now runs $TO_TAG"
info "API: $(api_url)"
info "UI:  $(ui_url)"
