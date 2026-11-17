# @eso/host-runtime — Mode A host entrypoint

Host-side runtime for ESO. A user prompt activates one worker of the published flow:

```text
prompt -> config snapshot (ESO, read-only) -> worker -> tier/model -> adapter -> evidence
       -> host-side flow step -> observation (ESO, append-only)
```

**ESO is config + sidecar + observatory + control plane. ESO is never the runtime.** This package
runs on the host: it reads configuration, spawns the local agent CLI, and appends observations.
ESO never runs, queues, claims, advances, spawns or calls a model — and this package never asks it to.

## Layout

```text
host-runtime/
  src/
    cli.ts               CLI (run, --help, --json, exit codes)
    entrypoint.ts        orchestrator (snapshot -> worker -> model -> adapter -> evidence -> observation)
    config-client.ts     GET /consumers/:id/config-snapshot + version hash validation
    flow-engine.ts       pure nextEdge(flow, workerId, outcome) — host-side flow semantics
    model-resolver.ts    explicit --model -> runtime defaultModel -> MODEL_UNAVAILABLE (no fake catalog)
    worker-policy.ts     worker selection + placement (allowedHosts runtime key)
    prompt-builder.ts    worker instructions + flow context + user prompt
    evidence.ts          PASS/FAIL/BLOCKED, bounded tails, prompt/token redaction
    observation-client.ts POST/GET observations (idempotent, retry-safe)
    adapters/            types · dry · cursor · agy (the only process-spawn code)
    shims.d.ts           minimal Node/Bun ambient types (the package has zero npm dependencies)
  test/                  bun test suites (83 tests)
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

## Known ESO gaps (host-side workarounds)

- **Snapshot version canonicalization.** The control plane's `canonical()` treats a JS `Date` as an
  object with no enumerable keys, so `platform.host_runtime.last_heartbeat` (a `Date` returned by SQL)
  hashes as `{}` and is not covered by the version/ETag — a heartbeat change does not change
  `version`. `validateSnapshotVersion` replays that rule for known `lastHeartbeat` values and accepts
  the result as `canonicalization: 'eso-date-collapse'`; everything else in the snapshot is still
  drift-checked. Builder note: if the control plane later fixes canonicalization, the strict JSON
  path still validates.
- **Model tier.** `workerPlacement.modelTier` has no model catalog mapping; see the model-resolution
  section above. The gap is recorded in evidence (`tier`, `modelSource`) and logged as
  `MODEL_TIER_NOT_MAPPED`.

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
| 0 | PASS — flow ended or `--max-steps` reached |
| 1 | FAIL — a worker reported FAIL |
| 2 | BLOCKED (`MODEL_UNAVAILABLE`, `ADAPTER_UNAVAILABLE`, worker/placement/flow errors) or usage/config error |

## Verify

```bash
cd host-runtime
bun test                 # 81 tests
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
