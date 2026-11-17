# Cursor integration (Mode A)

Cursor is the host. The user prompt still belongs to Cursor; this integration only lets the Cursor
session activate the SLP entrypoint of `@eso/host-runtime` and report what happened as an
observation. ESO stores configuration and observations — it does not start or run anything.

## Prerequisite

Cursor's runtime registration must exist in ESO (hosts + runtimes page or `PUT /api/v1/hosts/...`)
and the worker must be placed on `cursor:cursor-agent` (`allowedHosts`). Load the config first:

```bash
curl -s -H "Authorization: Bearer $ESO_HOST_TOKEN" \
  "http://127.0.0.1:8787/api/v1/consumers/testeso/config-snapshot?runtimeKey=cursor:cursor-agent" | head -c 400
```

## Entrypoint options

Cursor can activate the entrypoint in four ways; pick one and keep it thin (the CLI does the work):

1. **Command (recommended)** — a Cursor command whose body runs the CLI with the user's text.
2. **Rule** — an always-apply rule that says: for SLP tickets, run
   `bun run host-runtime/src/cli.ts run --consumer <id> --runtime-key cursor:cursor-agent …`.
3. **Subagent/agent** — a Cursor agent that shells out to the same CLI.
4. **Hook** — a Cursor hook that appends the CLI invocation on a ticket-shaped prompt.

The host runtime never needs Cursor-internal APIs; it needs the absolute `cursor-agent` path
(auto-resolved) and the ESO host token.

## Command shape

```text
# Cursor command body (arguments: the user prompt)
bun run host-runtime/src/cli.ts run \
  --consumer testeso \
  --runtime-key cursor:cursor-agent \
  --prompt "$ARGUMENTS" \
  --flow that-tinh-tran \
  --adapter cursor \
  --max-steps 1 \
  --json
```

Set `ESO_BASE_URL`, `ESO_CONSUMER`, `ESO_RUNTIME_KEY` and `ESO_HOST_TOKEN` in the host shell (or the
command env). Use `--adapter dry --dry-run` first: it exercises the whole path and writes a real
observation without calling a model.

## What Cursor keeps owning

- the user prompt and the conversation;
- the workspace (the CLI uses `consumer.root` as the adapter cwd by default, `--cwd` overrides);
- execution, model selection and the `cursor-agent` process;
- evidence content (the CLI posts it to ESO as an observation).

## What ESO sees

Only append-only observations:

```json
{
  "observationId": "obs-worker-build-1-...",
  "traceId": "...",
  "hostId": "cursor",
  "runtimeKey": "cursor:cursor-agent",
  "workerId": "worker-build",
  "event": "worker.completed",
  "outcome": "PASS",
  "evidence": { "outcome": "PASS", "exitCode": 0, "model": "auto", "adapter": "cursor", "stdoutTail": "…" }
}
```

No prompt body, no token, no run/claim/advance vocabulary.
