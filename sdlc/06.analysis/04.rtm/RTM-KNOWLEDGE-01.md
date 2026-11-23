---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-47.md"
status: DRAFT
phase: 1
id: RTM-KNOWLEDGE-01
type: traceability-matrix
---

# RTM-KNOWLEDGE-01 — `settings?tab=knowledge` (index slice)

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-47-1` | `SCN-47-1` · `02` | `GET .../knowledge/docs` | `knowledge_doc` · `knowledge_doc_path` | `qc/eso-settings-knowledge-docs.test.mjs` |
| `AC-47-2` | `SCN-47-3` · `04` | `GET .../knowledge/docs` (summary) | `knowledge_doc` · `knowledge_edge` | `qc/eso-settings-knowledge-docs.test.mjs` |
| `AC-47-3` | `SCN-47-5` | `GET .../knowledge/check` | — | `qc/eso-settings-knowledge-docs.test.mjs` |
| `AC-47-4` | `SCN-47-6` | — | — | `qc/eso-settings-knowledge-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **4/4** |
| `AC` có test chạy được | **4/4** doc+code |
| **API test** | **chưa có** — `OPEN-KNOWLEDGE-API-TEST` |
| **Phạm vi** | chỉ khối `Knowledge index`; 6 khối còn lại xem `00.index` |
