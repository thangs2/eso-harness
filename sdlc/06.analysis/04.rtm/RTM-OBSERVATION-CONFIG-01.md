---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-49.md"
status: DRAFT
phase: 1
id: RTM-OBSERVATION-CONFIG-01
type: traceability-matrix
---

# RTM-OBSERVATION-CONFIG-01 — `settings?tab=observation`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-49-1` | `SCN-49-1` · `02` | `PUT /consumers/{id}` | `platform.consumer` | `qc/eso-settings-observation-docs.test.mjs` |
| `AC-49-2` | `SCN-49-3` | `PUT /consumers/{id}` | `platform.consumer` | `qc/eso-settings-observation-docs.test.mjs` |
| `AC-49-3` | `SCN-49-4` · `05` | `PUT /consumers/{id}` | — | `qc/eso-settings-observation-docs.test.mjs` |
| `AC-49-4` | `SCN-49-6` | `GET .../observations` | `knowledge_observation` | `qc/eso-settings-observation-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **4/4** |
| `AC` có test chạy được | **4/4** doc+code |
| **API test** | **chưa có** — `OPEN-OBSERVATION-CONFIG-API-TEST` |
