---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-OBS-01.md"
status: DRAFT
phase: 1
id: RTM-OBS-01
type: traceability-matrix
---

# RTM-OBS-01 — `/observatory`

| AC | SCN | endpoint (SRS §6) | bảng | test |
|---|---|---|---|---|
| `AC-OBS-01-01` | `SCN-OBS-01-01` | #1 · #3 | `knowledge_observation` | `qc/eso-observatory-docs.test.mjs` |
| `AC-OBS-01-02` | `SCN-OBS-01-02` | #1 · #3 | `knowledge_observation` | `qc/eso-observatory-docs.test.mjs` |
| `AC-OBS-01-03` | `SCN-OBS-01-03` · `04` · `05` | #3 | `knowledge_observation` | `qc/eso-observatory-docs.test.mjs` |
| `AC-OBS-01-04` | `SCN-OBS-01-06` · `07` | #4 · #5 | `knowledge_flow` | `qc/eso-observatory-docs.test.mjs` |
| `AC-OBS-01-05` | `SCN-OBS-01-08` · `09` · `10` · `11` | #3 | `knowledge_observation` | `qc/eso-observatory-docs.test.mjs` |
| `AC-OBS-01-06` | `SCN-OBS-01-12` · `13` | #6 · #7 · #8 | `knowledge_observation` | `qc/eso-observatory-docs.test.mjs` |
| `AC-OBS-01-07` | `SCN-OBS-01-14` · `15` · `16` | #1..#8 | — | `qc/eso-observatory-docs.test.mjs` |
| `AC-OBS-01-08` | `SCN-OBS-01-17` | #1..#8 | — | `qc/eso-observatory-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **8/8** |
| `SCN` | 17 |
| `AC` có test chạy được | **8/8** — `qc/eso-observatory-docs.test.mjs` (10 test) |
| `tenant` | `OUT` + lý do (SCN §2) |
| `rbac` | có (2 SCN) |

**Loại test:** *doc-conformance* — kiểm **tài liệu ↔ code** (điều kiện "tài liệu đầy đủ"). Test hành vi UI (render, click) **chưa có**, thuộc giai đoạn build.
