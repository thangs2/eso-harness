# deploy/bin — runtime entrypoints

> **`stack/*` and `shared/*` manage container mode only.** Local host-native CP/UI commands are in
> [`deploy/README.md`](../README.md) — only PostgreSQL runs in Docker in that mode.

| Script | Scope | Service |
|---|---|---|
| `env-init.sh` | env | stack |
| `shared/build.sh [--env] [--no-pull] [control-plane\|ui\|all]` | image build | both |
| `shared/logs.sh [--env] [service]` | logs | both |
| `shared/shell.sh [--env] [service]` | shell | both |
| `stack/start.sh` · `stack/stop.sh` · `stack/restart.sh` | lifecycle | stack |
| `stack/status.sh` | health | stack |
| `stack/deploy.sh` | deploy | stack |
| `stack/rollback.sh` | rollback | stack |
| `stack/e2e.sh` | e2e | stack |
| `cp/build.sh` · `cp/logs.sh` · `cp/shell.sh` | CP | `control-plane` |
| `ui/build.sh` · `ui/logs.sh` · `ui/shell.sh` | UI | `ui` |
| `db/backup.sh` · `db/restore.sh` | DB | `postgres` |

CP = control-plane (BE) · UI = Angular frontend (FE) · DB = PostgreSQL.
`lib.sh` is sourced by every script; do not execute it directly.
