---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-46.md"
status: DRAFT
phase: 1
id: RTM-WORKER-CONFIG-01
type: traceability-matrix
---

# RTM-WORKER-CONFIG-01 — `settings?tab=workers` (cấu hình)

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-46-1` | `SCN-46-1` · `02` | `GET .../workers` | `knowledge_worker` | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-46-2` | `SCN-46-3` | `PUT .../workers` | `knowledge_worker` | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-46-3` | `SCN-46-4` | `PUT .../workers` | — | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-46-4` | `SCN-46-5` | `GET .../worker-placement` · `PUT .../workers/{workerId}/placement` | `knowledge_worker_placement` | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-46-5` | `SCN-46-6` · `07` | `POST .../workers/import/preview` · `POST .../workers/import/audit` | `knowledge_worker_import` | `qc/eso-settings-workers-docs.test.mjs` |
| `AC-46-6` | `SCN-46-8` · `09` | `POST .../workers/{id}/check` | `knowledge_worker_host_policy` | `qc/eso-settings-workers-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **6/6** |
| `AC` có test chạy được | **6/6** doc+code |
| **API test** | **chưa có** — `OPEN-WORKER-CONFIG-API-TEST` |
