# CI adapters

ESO does not depend on a CI provider. The contract is one command:

```bash
node scripts/verify.mjs --full
```

Provider files are optional adapters:

| Provider | File | Required? |
|---|---|---|
| GitHub Actions | `.github/workflows/*.yml` | optional |
| GitLab CI | `.gitlab-ci.yml` | optional, add if used |
| Jenkins / Buildkite / local | call `node scripts/verify.mjs --full` | optional |

Disable CI by deleting provider files; ESO still runs. Never put secrets in provider files.

Extra suites:

```bash
node scripts/verify.mjs --load
node scripts/verify.mjs --stress
node scripts/verify.mjs --e2e-consumers
node scripts/verify.mjs --full --coverage
node scripts/ci/cross-host-smoke.mjs
```

`cross-host-smoke` is repeatable from cron or any CI. It checks both hosts' `/health`, then
runs the flow orchestrator. Set `ESO_DRY=0` for real adapters. Example crontab (dry every 6h):

```cron
0 */6 * * * cd /repo && ESO_OPERATOR_TOKEN=... ESO_CONSUMER=fineso ESO_FLOW=that-tinh-tran   ESO_RUNTIME_KEY=cursor:cursor-agent ESO_REMOTE_TOKEN=...   ESO_REMOTE_HOSTS='{"agy:agy":"http://127.0.0.1:8788"}'   ESO_WORKSPACE_REPO=/repo/FinESO node scripts/ci/cross-host-smoke.mjs >> /tmp/cross-host.log 2>&1
```

Current suite includes unit/service tests, deterministic property tests for write-policy,
consumer E2E (setup/index/flow/placement/P8), load smoke and stress smoke. Coverage is reported
for control-plane tests.

CI is opt-in: no pipeline file is required to run ESO. Delete `.github/` and/or add a GitLab
pipeline that calls the same command; the product is unaffected.
