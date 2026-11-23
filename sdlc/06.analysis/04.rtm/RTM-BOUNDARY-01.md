---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-48.md"
status: DRAFT
phase: 1
id: RTM-BOUNDARY-01
type: traceability-matrix
---

# RTM-BOUNDARY-01 — `settings?tab=boundaries`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-48-1` | `SCN-48-1` · `02` | `GET .../boundaries` | `knowledge_boundary` | `qc/eso-settings-boundaries-docs.test.mjs` |
| `AC-48-2` | `SCN-48-3` | `PUT .../boundaries` | `knowledge_boundary` | `qc/eso-settings-boundaries-docs.test.mjs` |
| `AC-48-3` | `SCN-48-4` · `05` | `POST/DELETE .../boundaries/grants` | `knowledge_boundary_grant` | `qc/eso-settings-boundaries-docs.test.mjs` |
| `AC-48-4` | `SCN-48-6` · `07` | `PUT .../boundaries` | — | `qc/eso-settings-boundaries-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **4/4** |
| `AC` có test chạy được | **4/4** doc+code |
| **API test** | **chưa có** — `OPEN-BOUNDARY-API-TEST` |
