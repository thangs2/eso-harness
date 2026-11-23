---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-04.md"
status: DRAFT
phase: 1
id: RTM-CON-01
type: traceability-matrix
---

# RTM-CON-01 — `/consumers`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-04-1` | `SCN-04-1` | `GET /consumers` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-04-2` | `SCN-04-2` | `GET /consumers` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-04-3` | `SCN-04-3` | `GET /consumers` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-04-4` | `SCN-04-4` | `GET /consumers` | `platform.consumer` | `qc/eso-consumers-docs.test.mjs` |
| `AC-04-5` | `SCN-04-5` · `SCN-04-6` | `GET /consumers` | `platform.consumer` | `qc/eso-consumers-docs.test.mjs` |
| `AC-04-6` | `SCN-04-7` | `GET /consumers` | `platform.consumer` | `qc/eso-consumers-docs.test.mjs` |
| `AC-04-7` | `SCN-04-8` · `SCN-04-9` | `GET /consumers` | — | `qc/eso-consumers-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **7/7** |
| `SCN` | 9 |
| `AC` có test chạy được | **7/7** (3 API · 4 doc-conformance) |
| `tenant` | `OUT` + lý do (SCN-04 §OUT) |
| `rbac` | có (`SCN-04-9`) |

**Loại test 4–7:** doc + code-conformance (kiểm tài liệu ↔ source), không phải test render.
