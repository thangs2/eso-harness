# ESO deployment

Deployment assets for the ESO control plane and UI. The configuration files contain no runtime state
and no secrets. The deploy wrappers create `deploy/.state/`, `deploy/backups/`, and `deploy/logs/` on
demand; those paths are not part of the build.

## Layout

```text
deploy/
  bin/       lib.sh · env-init.sh
  bin/shared/  build.sh · logs.sh · shell.sh (shared implementation)
  bin/stack/   start · stop · restart · status · deploy · rollback · e2e
  bin/cp/      build · logs · shell (control-plane)
  bin/ui/      build · logs · shell (ui)
  bin/db/      backup · restore (PostgreSQL)
  compose/   compose.dev.yml · compose.prod.yml · compose.e2e.yml
  docker/    nginx.conf · postgres-init.sql (Dockerfiles live in eso/control-plane and eso/ui)
  env/       dev.env.example · staging.env.example · prod.env.example · .gitignore
  README.md
```

Compose paths are relative to the compose file, so the stack can be launched from the repository root
or from `deploy/`. The project name is always `eso`, and the services are `postgres`, `control-plane`,
and `ui`; `compose.e2e.yml` adds a one-shot `smoke` service.

## Prerequisites

- Docker Engine 24 or newer with the Compose v2 plugin (`docker compose version`).
- `curl` on the host for the smoke checks.
- Repository checkout at the root that contains both `eso/` and `deploy/`.
- An env file copied from the matching template.
- For staging/prod: images already published to `ESO_REGISTRY` with the selected `ESO_IMAGE_TAG`.

The dev compose file builds locally. The prod compose file never builds; it only pulls registry images.
The e2e compose file builds both application images and runs a disposable stack with no host ports.

## Quickstart (dev)

```bash
# 1. Init: create the ignored runtime env file and runtime directories.
bash deploy/bin/env-init.sh --env dev

# 2. Validate the rendered configuration.
docker compose -f deploy/compose/compose.dev.yml --env-file deploy/env/dev.env config -q

# 3. Build the two local images.
bash deploy/bin/shared/build.sh --env dev

# 4. Start the stack and wait for health.
bash deploy/bin/stack/start.sh --env dev

# 5. Check both health endpoints.
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:4200/healthz

# Stop; volumes are preserved.
bash deploy/bin/stack/stop.sh --env dev
```

The `Makefile` exposes the same operations as targets (`make init`, `make build`, `make up`,
`make status`, `make e2e`, `make backup`, and so on).

Develop on the host instead of in containers when that is faster:

```bash
cd eso/control-plane && ESO_DB_URL=postgres://eso:eso-dev-only-password@127.0.0.1:5432/eso ESO_PORT=8787 \
  ESO_AUTH_USER=operator ESO_AUTH_PASSWORD=operator-dev ESO_API_TOKEN=token-dev bun src/common/http/server.ts
cd eso/ui && bun run serve
```

## Environment variables

Copy a template to a runtime file and edit the values. Runtime files match the ignored `*.env`
pattern; only `*.env.example` is committed.

| Key | Required | Default | Purpose |
|---|---|---|---|
| `ESO_ENV` | yes | — | Environment name; must match the file (`dev`, `staging`, `prod`). |
| `ESO_IMAGE_TAG` | yes | `dev` in dev compose | Image tag. Dev builds use `eso/<service>:<tag>`; prod pulls `$ESO_REGISTRY/eso-<service>:<tag>`. |
| `ESO_REGISTRY` | staging/prod | — | Registry namespace, for example `ghcr.io/example-org`. |
| `ESO_DB_NAME` | yes | `eso` | PostgreSQL database created by the postgres image. |
| `ESO_DB_USER` | yes | `eso` | PostgreSQL user. |
| `ESO_DB_PASSWORD` | yes | — | PostgreSQL password. Use a placeholder in committed templates. |
| `ESO_DB_PORT` | dev | `5432` | Host port for PostgreSQL in dev. It is not published in prod or e2e. |
| `ESO_API_PORT` | dev/prod | `8787` | Host port for the control-plane HTTP endpoint. |
| `ESO_UI_PORT` | dev/prod | `4200` | Host port for the UI. |
| `ESO_AUTH_TOKEN` | yes | — | Shared auth token. Compose also maps it to the current Bun server's Bearer token and Basic password. |
| `ESO_AUTH_PROJECT` | yes | `eso` | Project scope passed to the control-plane. |
| `ESO_HEALTH_TIMEOUT` | yes | `120` | Seconds the runtime wrappers wait for a healthy service before failing. |
| `ESO_LOG_TAIL` | yes | `200` | Default number of log lines shown by a deploy log command. |
| `ESO_BACKUP_KEEP` | yes | `14` | Number of backup files the retention step keeps. |

`dev.env.example` carries working local-only placeholders. Staging and prod templates use
`CHANGE_ME` and must be edited before use. The only registry value committed is the example
`ghcr.io/example-org`.

The control-plane container receives `ESO_PORT=8788` for Bun and is published on 8787 through
socat. For compatibility with the current server entrypoint, compose also maps `ESO_AUTH_TOKEN` to
`ESO_API_TOKEN` and the Basic password; the Basic username defaults to `operator`. Keep one secret in
the env file and rotate it there.

## Script and command reference

The runtime wrappers live in `deploy/bin/`. They create the state, backup, and log directories on
demand; building or validating the configuration does not create them. Run them as
`bash deploy/bin/<group>/<script>` from the repository root (`env-init.sh` and `lib.sh` stay at the root).

CP/UI/DB mapping is in [`deploy/bin/README.md`](bin/README.md).

| Script | Operation | Notes |
|---|---|---|
| `env-init.sh --env <env>` | Create runtime env and directories | Copies the matching `*.env.example`, sets mode `0600`, and warns on remaining placeholders. |
| `shared/build.sh --env <env> [service]` | Build images | Builds `eso/control-plane/Dockerfile` and `eso/ui/Dockerfile`; never pushes. |
| `stack/start.sh --env <env>` | Start and wait for health | Runs `docker compose up -d --remove-orphans`. |
| `stack/stop.sh --env <env>` | Stop the stack | Volumes are kept unless `--volumes` is passed. |
| `stack/restart.sh --env <env> [--build]` | Restart and wait for health | `--build` rebuilds first. |
| `stack/status.sh --env <env>` | Show service and HTTP status | Exits non-zero unless all three services run and both endpoints return 200. |
| `shared/logs.sh --env <env> [service]` | Follow logs | Defaults to `ESO_LOG_TAIL` lines. |
| `stack/deploy.sh --env <env> [--pull]` | Build or pull, start, health-check, record state | Writes `deploy/.state/current.env` and rotates `previous.env`; `--pull` is for staging/prod. |
| `stack/rollback.sh --env <env> [--to TAG]` | Return to a previous image tag | Defaults to the tag in `deploy/.state/previous.env`. |
| `db/backup.sh --env <env>` | Dump PostgreSQL | Writes `deploy/backups/eso-<UTC>.dump` and prunes to `ESO_BACKUP_KEEP`. |
| `restore.sh --env <env> [--yes] DUMP` | Restore a dump | Stops the app, restores, starts the stack, and waits for health. |
| `e2e.sh [--keep]` | Run the disposable smoke stack | Uses project `eso-e2e`, no host ports, and preserves the smoke exit code. |

For a direct command instead of the wrappers:

```bash
docker compose -f deploy/compose/compose.dev.yml --env-file deploy/env/dev.env config -q
docker compose -f deploy/compose/compose.prod.yml --env-file deploy/env/prod.env pull
docker compose -f deploy/compose/compose.e2e.yml --env-file deploy/env/dev.env.example up \
  --abort-on-container-exit --exit-code-from smoke
```

## Compose matrix

| File | Images | Host ports | Database persistence | Used for |
|---|---|---|---|---|
| `compose.dev.yml` | Builds `eso/control-plane:${ESO_IMAGE_TAG:-dev}` and `eso/ui:${ESO_IMAGE_TAG:-dev}` | API `8787`, UI `4200`, DB `5432` (all env-overridable) | Named volume `postgres-data` | Local development |
| `compose.prod.yml` | Pulls `$ESO_REGISTRY/eso-control-plane:$ESO_IMAGE_TAG` and `$ESO_REGISTRY/eso-ui:$ESO_IMAGE_TAG` | API `8787` and UI `4200` (env-overridable); DB not published | Named volume `postgres-data` | Staging and production |
| `compose.e2e.yml` | Builds both application images; adds `curlimages/curl:8.10.1` smoke | None | `tmpfs` at `/var/lib/postgresql/data` | Disposable e2e/smoke |

All three files use the `eso` bridge network. The control-plane and UI healthchecks are the same in
every stack: the API check calls `http://127.0.0.1:8787/health`; the UI check calls
`http://127.0.0.1:8080/healthz`.

## Backup and restore

`backup.sh` runs `pg_dump -Fc` inside the postgres container and writes an archive under
`deploy/backups/`. That directory is runtime-owned and must not be committed.

```bash
# Dump the selected environment; the wrapper prunes to ESO_BACKUP_KEEP.
bash deploy/bin/db/backup.sh --env prod

# Restore a chosen dump. The wrapper stops the app, restores, starts it, and waits for health.
bash deploy/bin/db/restore.sh --env prod --yes deploy/backups/eso-YYYYMMDDTHHMMSSZ.dump
```

The restore path removes replaced objects with `--clean --if-exists --no-owner`. Take a fresh dump
before any rollback; the stack does not roll the database back automatically.

## Rollback

Application rollback uses the previous image tag; it does not rewrite the database.

```bash
# Roll back to the tag recorded in deploy/.state/previous.env.
bash deploy/bin/stack/rollback.sh --env prod

# Or name an explicit tag.
bash deploy/bin/stack/rollback.sh --env prod --to 2026-11-09.1
```

The script overrides `ESO_IMAGE_TAG`, recreates the stack, waits for both health endpoints, and
writes the newly selected tag to `deploy/.state/current.env`. If the database also has to move,
restore the dump taken before the change and then recreate `control-plane`.

## Security notes

- Never commit `deploy/env/<env>.env`, `deploy/.state/`, `deploy/backups/`, or `deploy/logs/`.
  `deploy/env/.gitignore` ignores every runtime `*.env` while keeping `*.env.example`.
- Committed templates contain placeholders only. Use a secret manager or an untracked runtime env
  file for real credentials.
- The prod compose file does not publish PostgreSQL. The API and UI are published on configurable
  host ports; terminate TLS at the host or an ingress in front of them.
- The nginx config sends security headers and proxies only the `/api/` surface. It is mounted
  read-only from `deploy/docker/nginx.conf`; the image does not bake a second copy.
- Logging is capped at 10 MB per file with three files per service in prod.
- Run the images without `privileged`, host networking, or a Docker socket mount unless a reviewed
  deployment requirement explicitly adds one.

## Troubleshooting

**The API healthcheck fails even though Bun started.** The Bun app binds `127.0.0.1:8788` by
contract; the image starts `socat TCP-LISTEN:8787,fork,reuseaddr TCP:127.0.0.1:8788` so the
container exposes 8787 to Compose and the nginx proxy. Check both layers:

```bash
docker compose -f deploy/compose/compose.dev.yml --env-file deploy/env/dev.env logs control-plane
docker compose -f deploy/compose/compose.dev.yml --env-file deploy/env/dev.env \
  exec control-plane sh -c 'wget -qO- http://127.0.0.1:8788/health; wget -qO- http://127.0.0.1:8787/health'
```

If 8788 answers but 8787 does not, the socat process is missing or was replaced; do not change the
product bind host, fix the container command instead. The healthcheck intentionally uses 8787.

**`/healthz` returns 404 or the UI route returns 404 after refresh.** Confirm the nginx mount is
present and that `try_files $uri $uri/ /index.html` is in the served config. The nginx config is not
baked into the image.

**The UI loads but API calls fail with 502.** The upstream is the Compose service name
`control-plane:8787`. Check that the API is healthy and that both services are on the `eso` network.

**`bind: address already in use`.** Change `ESO_API_PORT`, `ESO_UI_PORT`, or `ESO_DB_PORT` in the
runtime env file. E2E publishes no ports, so it does not have this conflict.

**Compose reports that `ESO_REGISTRY`, `ESO_IMAGE_TAG`, `ESO_DB_PASSWORD`, or `ESO_AUTH_TOKEN` is
required.** The prod file deliberately fails fast. Fill the value in the runtime env file; do not
add a default secret to a compose file.

**A stale dev database hides a registry change.** `down -v` deletes the named volume and all data.
Take a dump first, or use the disposable e2e stack when a clean database is acceptable.

For a one-command view of container state and both HTTP endpoints, run
`bash deploy/bin/stack/status.sh --env dev`.
