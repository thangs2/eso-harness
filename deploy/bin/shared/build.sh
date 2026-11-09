#!/usr/bin/env bash
# Build the control-plane and UI images with the contract tags.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../lib.sh"

usage() {
    cat <<'EOF'
Usage: build.sh [--env dev|staging|prod] [--no-pull] [control-plane|ui|all] [-h|--help]

Builds images for the selected environment. Dev tags are eso/<service>:<tag>;
staging and prod tags are $ESO_REGISTRY/eso-<service>:<tag>. Images are never pushed.

Options:
  --env NAME   Target environment (default: dev).
  --no-pull    Do not pass --pull to docker build.
  -h, --help   Show this help and exit.

Services:
  control-plane, ui, all (default: all).
EOF
}

PULL=1
BUILD_CONTROL_PLANE=0
BUILD_UI=0
TARGETS_GIVEN=0

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
        --no-pull)
            PULL=0
            shift
            ;;
        all)
            BUILD_CONTROL_PLANE=1
            BUILD_UI=1
            TARGETS_GIVEN=1
            shift
            ;;
        control-plane)
            BUILD_CONTROL_PLANE=1
            TARGETS_GIVEN=1
            shift
            ;;
        ui)
            BUILD_UI=1
            TARGETS_GIVEN=1
            shift
            ;;
        -*)
            warn "unknown option: $1"
            usage >&2
            exit 2
            ;;
        *)
            warn "unknown service: $1"
            usage >&2
            exit 2
            ;;
    esac
done

if [[ "$TARGETS_GIVEN" -eq 0 ]]; then
    BUILD_CONTROL_PLANE=1
    BUILD_UI=1
fi

set_env "$ESO_ENV"
load_env
require_cmd docker

if [[ "$ESO_ENV" == "staging" || "$ESO_ENV" == "prod" ]]; then
    require_vars ESO_REGISTRY ESO_IMAGE_TAG
else
    ESO_IMAGE_TAG="${ESO_IMAGE_TAG:-dev}"
fi
export ESO_IMAGE_TAG

IMAGE_TAG="$ESO_IMAGE_TAG"
if [[ "$ESO_ENV" == "dev" ]]; then
    CONTROL_PLANE_IMAGE="eso/control-plane:$IMAGE_TAG"
    UI_IMAGE="eso/ui:$IMAGE_TAG"
else
    REGISTRY="${ESO_REGISTRY%/}"
    CONTROL_PLANE_IMAGE="$REGISTRY/eso-control-plane:$IMAGE_TAG"
    UI_IMAGE="$REGISTRY/eso-ui:$IMAGE_TAG"
fi

build_image() {
    local service="$1"
    local image="$2"
    local dockerfile=""
    local context=""

    mkdir -p "$DOCKER_CONFIG"
    if [[ -f "$ROOT_DIR/eso/${service}/Dockerfile" ]]; then
        dockerfile="$ROOT_DIR/eso/${service}/Dockerfile"
    else
        die "Dockerfile not found for $service (looked in eso/$service)"
    fi
    # Both dockerfiles COPY service-relative paths (package.json, src, ...).
    context="$ROOT_DIR/eso/${service}"

    info "building $image"
    if [[ "$PULL" -eq 1 ]]; then
        docker build --pull -f "$dockerfile" -t "$image" "$context"
    else
        docker build -f "$dockerfile" -t "$image" "$context"
    fi
}

if [[ "$BUILD_CONTROL_PLANE" -eq 1 ]]; then
    build_image "control-plane" "$CONTROL_PLANE_IMAGE"
fi
if [[ "$BUILD_UI" -eq 1 ]]; then
    build_image "ui" "$UI_IMAGE"
fi

if [[ "$BUILD_CONTROL_PLANE" -eq 1 ]]; then
    info "control-plane image: $CONTROL_PLANE_IMAGE"
fi
if [[ "$BUILD_UI" -eq 1 ]]; then
    info "ui image: $UI_IMAGE"
fi
