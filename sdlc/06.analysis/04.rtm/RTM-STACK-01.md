---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-43.md"
status: DRAFT
phase: 1
id: RTM-STACK-01
type: traceability-matrix
---

# RTM-STACK-01 — `settings?tab=stack`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-43-1` | `SCN-43-1` · `02` | `GET .../stack-versions` | `platform.harness_stack_version` | `qc/eso-settings-stack-docs.test.mjs` |
| `AC-43-2` | `SCN-43-3` | `PUT .../stack-versions` | `platform.harness_stack_version` | `qc/eso-settings-stack-docs.test.mjs` |
| `AC-43-3` | `SCN-43-4` | `PUT .../stack-versions` | `platform.harness_stack_version` | `qc/eso-settings-stack-docs.test.mjs` |
| `AC-43-4` | `SCN-43-5` · `06` | `PUT .../stack-versions` | `platform.harness_stack_version` | `qc/eso-settings-stack-docs.test.mjs` |
| `AC-43-5` | `SCN-43-7` · `08` | — | — | `qc/eso-settings-stack-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **5/5** |
| `AC` có test chạy được | **5/5** doc+code |
| **API test** | **chưa có** — `OPEN-STACK-API-TEST` |
