---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-05.md"
status: DRAFT
phase: 1
id: RTM-DETAIL-01
type: traceability-matrix
---

# RTM-DETAIL-01 — `/consumers/:id`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-05-1` | `SCN-05-1` | `GET /consumers/{id}` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-05-2` | `SCN-05-2` | `GET /consumers/{id}` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-05-3` | `SCN-05-3` | `GET /consumers/{id}` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-05-4` | `SCN-05-4` | `GET /consumers/{id}` | `platform.consumer` | `qc/eso-consumer-detail-docs.test.mjs` |
| `AC-05-5` | `SCN-05-5` · `SCN-05-6` | — | — | `qc/eso-consumer-detail-docs.test.mjs` |
| `AC-05-6` | `SCN-05-7` · `SCN-05-8` · `SCN-05-9` | `GET /consumers/{id}` | — | `qc/eso-consumer-detail-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **6/6** |
| `SCN` | 9 |
| `AC` có test chạy được | **6/6** (3 API · 3 doc-conformance) |
| `rbac` | có (`SCN-05-8`) |
| `tenant` | `OUT` + lý do (SCN-05) |
