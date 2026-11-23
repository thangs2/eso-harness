# host-probe-runner (host-side reference)

CR-012: probe phải chạy **ở host**; control-plane chỉ nhận card và validate (`HostProbeService.assess`).
Script này là **mẫu tham chiếu** cho host implementer — nó không nằm trong runtime ESO và không spawn gì.

## Chạy

```bash
node tools/host-probe-runner/probe-runner.mjs \
  --base=http://127.0.0.1:8787 --consumer=demo --host-id=cursor --host-version=0.45.0 \
  --root=/path/to/consumer --token=<operator token>
```

## Evidence layout

```
<root>/.harness/probe/observe.json          { "status": "measured", "evidence": [{"kind":"session-event","summary":"..."}] }
<root>/.harness/probe/inject.json
<root>/.harness/probe/memoryRead.json
<root>/.harness/probe/memoryWrite.json      (cần evidence kind chứa "cross-session" để lên L4)
<root>/.harness/probe/mcpTools.json
<root>/.harness/probe/multiAgentRemoteCi.json
<root>/.harness/probe/blocked.json          { "reason": "policy forbids probe" }  -> publishLevels=false
```

Luật: `measured|partial` mà 0 evidence ⇒ hạ về `unknown`; `blocked` ⇒ không publish level.
