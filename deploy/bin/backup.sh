#!/usr/bin/env bash
# Back up the postgres database with pg_dump and prune old dumps.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib.sh"

usage() {
    cat <<'EOF'
Usage: backup.sh [ENV] [--env dev|staging|prod] [--out PATH] [-h|--help]

Runs pg_dump -Fc inside the postgres container and writes the archive to
deploy/backups/eso-<UTC>.dump by default. Keeps the newest ESO_BACKUP_KEEP
dumps (default 14) in deploy/backups.

ENV may be passed positionally (dev, staging, prod) or with --env.

Options:
  --env NAME   Target environment (default: dev).
  --out PATH   Write the dump to PATH instead of the default location.
  -h, --help   Show this help and exit.
EOF
}

OUT=""
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
        --out)
            if [[ $# -lt 2 ]]; then
                warn "--out requires a value"
                usage >&2
                exit 2
            fi
            OUT="$2"
            shift 2
            ;;
        --out=*)
            OUT="${1#*=}"
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
require_cmd docker
require_vars ESO_DB_USER ESO_DB_NAME

keep="${ESO_BACKUP_KEEP:-14}"
if ! [[ "$keep" =~ ^[1-9][0-9]*$ ]]; then
    die "ESO_BACKUP_KEEP must be a positive integer (got '$keep')"
fi

mkdir -p "$BACKUP_DIR"
if [[ -z "$OUT" ]]; then
    OUT="$BACKUP_DIR/eso-$(date -u +%Y%m%dT%H%M%SZ).dump"
fi
out_dir="$(dirname "$OUT")"
mkdir -p "$out_dir"

tmp="${OUT}.partial"
info "dumping database $ESO_DB_NAME as $ESO_DB_USER"
if ! compose exec -T postgres pg_dump -U "$ESO_DB_USER" -d "$ESO_DB_NAME" -Fc >"$tmp"; then
    rm -f "$tmp"
    die "pg_dump failed"
fi
if [[ ! -s "$tmp" ]]; then
    rm -f "$tmp"
    die "pg_dump produced an empty file"
fi
mv -f "$tmp" "$OUT"
chmod 600 "$OUT" 2>/dev/null || true
info "backup written: $OUT"

excess="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'eso-*.dump' | sort -r | tail -n +$((keep + 1)))"
if [[ -n "$excess" ]]; then
    printf '%s\n' "$excess" | while IFS= read -r old_dump; do
        if [[ -n "$old_dump" ]]; then
            info "pruning old backup: $old_dump"
            rm -f -- "$old_dump"
        fi
    done
fi
