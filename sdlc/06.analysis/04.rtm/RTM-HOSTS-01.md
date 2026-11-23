---
sot_doc_version: "0.2.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-54.md"
status: DRAFT
phase: 1
id: RTM-HOSTS-01
type: traceability-matrix
---

# RTM-HOSTS-01 — `/hosts`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-54-1` | `SCN-54-1` | `PUT /hosts/{hostId}` | `platform.host` · `platform.host_runtime` | MISSING |
| `AC-54-2` | `SCN-54-2` · `03` | — (validate client) | — | MISSING |
| `AC-54-3` | `SCN-54-4` | `PUT /hosts/{hostId}` · `PUT /hosts/{hostId}/runtimes/{runtimeId}` | `platform.host_runtime` | MISSING |
| `AC-54-4` | `SCN-54-5` | `POST /hosts/{hostId}/runtimes/{runtimeId}/heartbeat` | `platform.host_runtime` | MISSING |
| `AC-54-5` | `SCN-54-6` | — (dữ liệu runtime) | — | MISSING |
| `AC-54-6` | `SCN-54-7` | — | — | MISSING |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **6/6** |
| `AC` có test chạy được | **0/6** — `OPEN-HOSTS-UI-TEST` |
