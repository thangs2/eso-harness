---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-42.md"
status: DRAFT
phase: 1
id: RTM-FLOW-01
type: traceability-matrix
---

# RTM-FLOW-01 — `/consumers/:id/flows`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-42-1` | `SCN-42-1` · `02` | `GET .../flows` | `knowledge_flow` | `eso/control-plane/test/flows.test.ts` |
| `AC-42-2` | `SCN-42-3` | `GET .../flows/{flowId}` | `knowledge_flow` | `eso/control-plane/test/flows.test.ts` |
| `AC-42-3` | `SCN-42-4` · `05` | `POST .../flows` | `knowledge_flow` | `qc/eso-flows-docs.test.mjs` |
| `AC-42-4` | `SCN-42-6` · `07` | `PUT .../flows/{flowId}` | `knowledge_flow` | `qc/eso-flows-docs.test.mjs` |
| `AC-42-5` | `SCN-42-8` | — (client canvas) | — | `qc/eso-flows-docs.test.mjs` |
| `AC-42-6` | `SCN-42-9` | — | — | `qc/eso-flows-docs.test.mjs` |
| `AC-42-7` | `SCN-42-10…12` | `POST .../flows/{flowId}/validate` | — | `eso/control-plane/test/flows.test.ts` |
| `AC-42-8` | `SCN-42-13` | `POST .../flows/{flowId}/publish` | `knowledge_flow` | `eso/control-plane/test/flows.test.ts` |
| `AC-42-9` | `SCN-42-14` · `15` | `PUT .../flows/default` | `knowledge_flow` | `eso/control-plane/test/flows.test.ts` |
| `AC-42-10` | `SCN-42-16` | `DELETE .../flows/{flowId}/draft` | `knowledge_flow` | `eso/control-plane/test/flows.test.ts` |
| `AC-42-11` | `SCN-42-17…19` | nhiều | — | `qc/eso-flows-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **11/11** |
| `SCN` | 19 (+1 `OUT` tenant) |
| `AC` có test chạy được | **11/11**: 6 AC có test API thật (`flows.test.ts`, 8 test) · 5 AC doc-conformance |
| **API flow test tự động** | **có** — `eso/control-plane/test/flows.test.ts` (8 test: list · get · validate · publish · immutable · default · delete · versions) |

> Còn nợ: **canvas E2E** (`OPEN-FLOW-CANVAS-E2E`) — không có browser runner trong repo; `SCN-42-8/9` để `manual`.
