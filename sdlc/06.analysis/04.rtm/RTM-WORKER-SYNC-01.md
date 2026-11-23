---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-45.md"
status: DRAFT
phase: 1
id: RTM-WORKER-SYNC-01
type: traceability-matrix
---

# RTM-WORKER-SYNC-01 — `settings?tab=workers` (source sync)

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-45-1` | `SCN-45-1` · `02` | `GET .../workers/sync/status` | `knowledge_worker` | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-45-2` | `SCN-45-3` | `POST .../workers/sync` | `knowledge_worker` | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-45-3` | `SCN-45-4` | `POST .../workers/sync/promote/{workerId}` | `knowledge_worker` | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-45-4` | `SCN-45-5` · `06` | — | — | `qc/eso-settings-workers-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **4/4** |
| `AC` có test chạy được | **4/4** doc+code |
| **API test** | **chưa có** — `OPEN-WORKER-SYNC-API-TEST` |
| **Cấu hình worker** | tách sang [`RTM-WORKER-CONFIG-01`](RTM-WORKER-CONFIG-01.md) (`F-45`) |
