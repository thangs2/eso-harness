# @eso/host-runtime — Mode A entrypoint + Mode B dispatch

Host-side runtime for ESO. A user prompt activates one worker of the published flow:

```text
Mode A (local):
  prompt -> config snapshot (ESO, read-only) -> worker -> tier/model -> adapter -> evidence
         -> host-side flow step -> observation (ESO, append-only)

Mode B (host A -> host B):
  host A: snapshot + placement -> signed job envelope (HMAC) -> POST /jobs to host B
  host B: verify signature -> validate workspace -> run the worker locally (Mode A path)
          -> signed result envelope + B observation
  host A: verify signed result -> A observation worker.remote.completed/failed
```

**ESO is config + sidecar + observatory + control plane. ESO is never the runtime.** This package
runs on the host: it reads configuration, spawns the local agent CLI, and appends observations.
ESO never runs, queues, claims, advances, spawns or calls a model — and this package never asks it to.

## Layout

```text
host-runtime/
  src/
    cli.ts               CLI (run | dispatch | serve, --help, --json, exit codes)
    server.ts            `serve` entry point (Mode B remote runtime)
    entrypoint.ts        orchestrator (snapshot -> worker -> model -> adapter -> evidence -> observation)
    config-client.ts     GET /consumers/:id/config-snapshot + version hash validation
    flow-engine.ts       pure nextEdge(flow, workerId, outcome) — host-side flow semantics
    model-resolver.ts    explicit --model -> runtime defaultModel -> MODEL_UNAVAILABLE (no fake catalog)
    worker-policy.ts     worker selection + placement (allowedHosts runtime key)
    prompt-builder.ts    worker instructions + flow context + user prompt
    evidence.ts          PASS/FAIL/BLOCKED, bounded tails, prompt/token redaction
    observation-client.ts POST/GET observations (idempotent, retry-safe)
    adapters/            types · dry · cursor · agy (the only process-spawn code)
    remote/envelope.ts   Mode B job/result envelopes + HMAC-SHA256 sign/verify
    remote/client.ts     dispatchRemote: POST /jobs, verify signed result, timeout
    remote/server.ts     Bun.serve POST /jobs + GET /health (bearer + HMAC + workspace guard)
    remote/workspace.ts  workspace validation (absolute, directory, allowed roots, git commit)
    remote/dispatch.ts   A-side orchestration + local worker.remote.* observation
    shims.d.ts           minimal Node/Bun ambient types (the package has zero npm dependencies)
  test/                  bun test suites (140 tests)
  README.md
  integrations/cursor/README.md
  integrations/agy/README.md
```

No runtime dependencies. Bun + TypeScript + Node builtins only (`fetch` + `node:child_process`).
TypeScript is a dev dependency for `bun run typecheck`; `node_modules/` is gitignored.

## Environment

| Variable | Meaning |
|---|---|
| `ESO_BASE_URL` | control plane, default `http://127.0.0.1:8787` |
| `ESO_CONSUMER` | consumer id, e.g. `testeso` |
| `ESO_RUNTIME_KEY` | `hostId:runtimeId`, e.g. `cursor:cursor-agent` |
| `ESO_HOST_TOKEN` | scoped host bearer (preferred; snapshot + observation only for its own runtime) |
| `ESO_OPERATOR_TOKEN` | operator bearer (fallback) |
| `ESO_AUTH_TOKEN` | operator bearer (legacy fallback) |
| `ESO_CURSOR_AGENT_BIN` | absolute path to `cursor-agent` (otherwise resolved automatically) |
| `ESO_AGY_BIN` | absolute path to `agy` (otherwise resolved automatically) |
| `ESO_REMOTE_TOKEN` | Mode B shared secret (bearer + HMAC, min 8 chars) |
| `ESO_REMOTE_ALLOWED_WS` | comma-separated workspace roots host B may run in |
| `ESO_REMOTE_URL` | fallback remote endpoint when the snapshot has no `remoteUrl` |

Credential precedence: `ESO_HOST_TOKEN` (scoped, `auth: host`) then `ESO_OPERATOR_TOKEN` /
`ESO_AUTH_TOKEN` (`auth: operator`). ESO credentials are stripped from the child process environment
before an adapter spawns a model CLI.

## CLI

```bash
cd host-runtime

# deterministic dry run — no model call, but a REAL observation is written
ESO_BASE_URL=http://127.0.0.1:8787 \
ESO_HOST_TOKEN=... \
bun run src/cli.ts run \
  --consumer testeso \
  --runtime-key cursor:cursor-agent \
  --prompt "Implement the P3 ticket." \
  --flow that-tinh-tran \
  --worker worker-build \
  --adapter dry \
  --dry-run \
  --max-steps 1 \
  --json

bun run src/cli.ts --help
```

### Mode B — dispatch from host A, serve on host B

```bash
# host B: remote runtime (needs its own scoped host token + the shared secret)
ESO_BASE_URL=http://127.0.0.1:8787 ESO_CONSUMER=testeso \
ESO_HOST_TOKEN=<agy:agy scoped token> ESO_REMOTE_TOKEN=<shared secret> \
ESO_REMOTE_ALLOWED_WS=/Users/me/Workspaces \
bun run src/server.ts serve --runtime-key agy:agy --port 8788 --host 127.0.0.1 --json

# host A: dispatch a dry job (remoteUrl from snapshot, or --remote-url override)
ESO_BASE_URL=http://127.0.0.1:8787 ESO_CONSUMER=testeso \
ESO_HOST_TOKEN=<cursor:cursor-agent scoped token> ESO_REMOTE_TOKEN=<shared secret> \
bun run src/cli.ts dispatch \
  --from-runtime-key cursor:cursor-agent --to-runtime-key agy:agy \
  --prompt "Implement the ticket." --flow that-tinh-tran --worker worker-build \
  --adapter dry --dry-run --remote-url http://127.0.0.1:8788 \
  --workspace-repo /Users/me/Workspaces/test-eso --trace-id p4-dry --json
```

Mode B guarantees:

- the job must be signed with `ESO_REMOTE_TOKEN` (HMAC-SHA256, constant-time verify) *and* carry it
  as a bearer;
- host B rejects jobs addressed to another runtime, from itself, with a bad workspace, or with a
  mismatched git commit/branch;
- B runs the worker through the same Mode A entrypoint and writes its own observation with its own
  scoped host token; A writes `worker.remote.completed` / `worker.remote.failed` with
  `evidence.remoteObservationId`;
- replaying the same `jobId` is idempotent: B returns the cached signed result and writes no second
  observation; A's observation dedupes on its idempotency key;
- prompts and tokens never appear in logs, results or observations.

`--dry-run` forces the deterministic dry adapter. It does **not** skip the config snapshot, model
resolution or the observation write: the real observation is the point of a dry integration, and it
is what makes the path verifiable end to end without calling a model.

## Flow semantics (host-side only)

1. Fetch the config snapshot (`?runtimeKey=`), validate `version` = sha256 of the canonical snapshot
   payload (same rule the control plane uses). A mismatch fails closed — no observation, exit 2.
2. Select the worker: `--worker` → flow entry node (no incoming edge) → documented fallback
   `worker-build`. Missing/inactive worker or missing/denying placement blocks with an observation.
3. Resolve the model:
   - explicit `--model` wins;
   - else the host runtime `defaultModel`;
   - else `MODEL_UNAVAILABLE` (BLOCKED evidence).
   **Documented gap:** `workerPlacement.modelTier` (`fast`/`balanced`/`reasoning`) is a placement
   intent, not a model catalog. There is no tier→model mapping on the host — inventing one would fake
   a contract ESO does not define. The resolved tier is recorded in evidence and a
   `MODEL_TIER_NOT_MAPPED` warning is logged.
4. Build the prompt from the worker definition + flow context + user prompt.
5. Run the adapter on the host (spawn, timeout, capture; the only place a process is spawned).
6. Build evidence: outcome `PASS`/`FAIL`/`BLOCKED`, exit code, duration, model, adapter, bounded
   stdout/stderr tails. The prompt body is never logged and is redacted if an adapter echoes it;
   credentials are redacted too.
7. Append an observation: `POST /api/v1/consumers/:id/observations` with
   `event=worker.completed|worker.failed`, idempotency key `traceId:workerId:hostStep`.
8. `nextEdge(flow, workerId, outcome)` decides the next worker; `--max-steps` (hard host cap 20) and
   the flow end stop the loop. No run state is sent to or stored in ESO.

## Mode B observations

| Host | event | runtimeKey | notes |
|---|---|---|---|
| B | `worker.completed` / `worker.failed` | target runtime (e.g. `agy:agy`) | full bounded evidence (Mode A entrypoint) |
| A | `worker.remote.completed` / `worker.remote.failed` | source runtime (e.g. `cursor:cursor-agent`) | summary evidence + `remoteObservationId`, `remoteRuntimeKey`, `remoteJobId` |

`jobId` is the trace id for both hosts, so the two observations correlate in ESO. ESO only stores
them: it never dispatches, queues, claims or runs anything.

## Known ESO gaps (host-side workarounds)

- **Snapshot version canonicalization.** The control plane's `canonical()` used to treat a JS `Date`
  as an object with no enumerable keys, so `platform.host_runtime.last_heartbeat` (a `Date` returned
  by SQL) hashed as `{}` and was excluded from the version/ETag (a heartbeat change did not change
  `version`). The control plane now serializes `Date` as ISO-8601 (commit `8f75f0e`), so the strict
  JSON path is the live one. `validateSnapshotVersion` still accepts the legacy Date-collapse result
  (`canonicalization: 'eso-date-collapse'`) so hosts survive a rolling upgrade against an older
  control plane; everything else in the snapshot is drift-checked.
- **Model tier.** `workerPlacement.modelTier` has no model catalog mapping; see the model-resolution
  section above. The gap is recorded in evidence (`tier`, `modelSource`) and logged as
  `MODEL_TIER_NOT_MAPPED`.
- **Mode B `remoteUrl` (P4 ESO config).** The host runtime accepts `remoteUrl` from the snapshot
  `hosts[].runtimes[]` DTO. Until the control-plane P4 config lands, pass `--remote-url` (or
  `ESO_REMOTE_URL`); a missing endpoint fails with `REMOTE_URL_MISSING`.
- **Observation cleanup.** ESO observations are append-only (no delete route), so Mode B smoke rows
  stay in the observatory; they are the evidence of the run.

## Tests

```bash
cd host-runtime && bun test     # Mode A + Mode B suites
```

## Adapters (Mode A = deterministic CLI first)

| Adapter | Command | Notes |
|---|---|---|
| `dry` | none | deterministic, no spawn, no model |
| `cursor` | `<cursor-agent> -p --model <model> <prompt>` | absolute path resolved before spawn |
| `agy` | `<agy> -p --model <model> <prompt>` | same contract |

`cursor-agent` is usually **not on PATH**; the adapter checks `ESO_CURSOR_AGENT_BIN`, then PATH, then
the Cursor agent-cli folder
(`~/Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent`).
`agy` is checked via `ESO_AGY_BIN`, PATH and `~/.gemini/bin`. Missing binary = BLOCKED evidence
(`ADAPTER_UNAVAILABLE`), never a fake pass. Timeout defaults to 15 minutes
(SIGTERM, then SIGKILL after 2 s).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | PASS — flow ended or `--max-steps` reached (dispatch: remote PASS) |
| 1 | FAIL — a worker reported FAIL |
| 2 | BLOCKED (`MODEL_UNAVAILABLE`, `ADAPTER_UNAVAILABLE`, worker/placement/flow errors) or usage/config error |

## Verify

```bash
cd host-runtime
bun test                 # 140 tests
bun run typecheck        # tsc --noEmit
```

The package has no npm dependencies, including `@types/node`; ambient declarations live in
`src/shims.d.ts`. `bun run typecheck` therefore needs `tsc` on PATH — the repo already ships
TypeScript under `eso/control-plane/node_modules/.bin`:

```bash
PATH="$PWD/../eso/control-plane/node_modules/.bin:$PATH" bun run typecheck
```

## What this package does NOT do

- no ESO control-plane/UI changes, no second source of truth;
- no queue/claim/advance/run domain — the only ESO write is an observation append;
- no model call in ESO, no host credentials held by ESO;
- no prompt body in evidence/logs, no secrets in logs.
