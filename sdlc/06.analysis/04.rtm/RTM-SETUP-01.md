---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-02.md"
status: DRAFT
phase: 1
id: RTM-SETUP-01
type: traceability-matrix
---

# RTM-SETUP-01 — `/setup`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-02-1` | `SCN-02-1` | `POST /consumers` | `platform.consumer` | `eso/control-plane/test/consumer.test.ts` |
| `AC-02-2` | `SCN-02-2` | `POST /consumers` | `platform.consumer` | `eso/control-plane/test/consumer.test.ts` |
| `AC-02-3` | `SCN-02-3` | `POST /consumers` | `platform.consumer` | `eso/control-plane/test/consumer.test.ts` |
| `AC-02-4` | `SCN-02-4` | `POST /consumers` | `platform.consumer` | `qc/eso-setup-docs.test.mjs` |
| `AC-02-5` | `SCN-02-5` | — | — | `qc/eso-setup-docs.test.mjs` |
| `AC-02-6` | `SCN-02-6` | — | — | `qc/eso-setup-docs.test.mjs` |
| `AC-02-7` | `SCN-02-7` | `GET /api/v1/fs/resolve-directory` | — | `qc/eso-setup-docs.test.mjs` |
| `AC-02-8` | `SCN-02-8` · `SCN-02-9` · `SCN-02-10` | `POST /consumers` | `platform.consumer` | `qc/eso-setup-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **8/8** |
| `SCN` | 10 |
| `AC` có test chạy được | **8/8** (3 API · 5 doc-conformance) |
| `rbac` | có (`SCN-02-8`) |
| `tenant` | `OUT` + lý do (SCN-02) |

**Loại test 4–8:** doc + code-conformance; test hành vi wizard thuộc giai đoạn build.
