# AGY integration (Mode A)

AGY is the host. The user prompt and the model turn belong to AGY; this integration only activates
the SLP entrypoint of `@eso/host-runtime` and reports what happened as an observation. ESO stores
configuration and observations — it does not start or run anything.

## Prerequisite

AGY's runtime registration must exist in ESO and the worker must be placed on `agy:agy`
(`allowedHosts`). The AGY CLI lives at `~/.gemini/bin/agy` (or `ESO_AGY_BIN`); it is resolved
explicitly before spawn.

```bash
curl -s -H "Authorization: Bearer $ESO_HOST_TOKEN" \
  "http://127.0.0.1:8787/api/v1/consumers/testeso/config-snapshot?runtimeKey=agy:agy" | head -c 400
```

## Entrypoint options

1. **Command (recommended)** — an AGY command running the CLI with the user's text.
2. **Agent** — an AGY agent that shells out to the same CLI (AGY `--agent`).
3. **Rule** — an AGY rule that routes SLP tickets to the CLI invocation.

Keep the integration thin: selection, model resolution, evidence and the observation write all live
in `host-runtime`, so AGY does not re-implement flow semantics.

## Command shape

```text
# AGY command body (arguments: the user prompt)
bun run host-runtime/src/cli.ts run \
  --consumer testeso \
  --runtime-key agy:agy \
  --prompt "$ARGUMENTS" \
  --flow that-tinh-tran \
  --adapter agy \
  --max-steps 1 \
  --json
```

Set `ESO_BASE_URL`, `ESO_CONSUMER`, `ESO_RUNTIME_KEY=agy:agy` and `ESO_HOST_TOKEN` in the host shell.
Start with `--adapter dry --dry-run`: it verifies the whole path and writes a real observation
without calling a model.

## Model note

AGY reports its own `defaultModel` (e.g. a Gemini model) in the host runtime registration. The CLI
uses that default unless `--model` is passed. `modelTier` from worker placement is recorded but not
mapped to a model — the host does not invent a tier→model catalog (documented gap in the package
README).

## What AGY keeps owning

- the user prompt and the conversation;
- the workspace and the `agy` process;
- execution, model selection and evidence content.

## What ESO sees

Only append-only observations (`event worker.completed|worker.failed`, `outcome PASS|FAIL|BLOCKED`,
bounded evidence tails). No prompt body, no token, no run/claim/advance vocabulary.
