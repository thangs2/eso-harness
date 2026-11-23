---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-44.md"
status: DRAFT
phase: 1
id: RTM-BINDING-01
type: traceability-matrix
---

# RTM-BINDING-01 — `settings?tab=hosts`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-44-1` | `SCN-44-1` · `02` | `GET .../hosts` · `GET /host-runtimes` | `host_binding` | `qc/eso-settings-hosts-docs.test.mjs` |
| `AC-44-2` | `SCN-44-3` | `PUT /consumers/{id}` | `host_binding` | `qc/eso-settings-hosts-docs.test.mjs` |
| `AC-44-3` | `SCN-44-4` | `PUT /consumers/{id}` | `host_binding` | `qc/eso-settings-hosts-docs.test.mjs` |
| `AC-44-4` | `SCN-44-5` | `PUT /consumers/{id}` | `host_binding` | `qc/eso-settings-hosts-docs.test.mjs` |
| `AC-44-5` | `SCN-44-7` · `08` | — | — | `qc/eso-settings-hosts-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **5/5** |
| `AC` có test chạy được | **5/5** doc+code |
| **API test** | **chưa có** — `OPEN-BINDING-API-TEST` |
