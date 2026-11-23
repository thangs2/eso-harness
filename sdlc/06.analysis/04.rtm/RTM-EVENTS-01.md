---
sot_doc_version: "0.2.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-53.md"
status: DRAFT
phase: 1
id: RTM-EVENTS-01
type: traceability-matrix
---

# RTM-EVENTS-01 — `/events`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-53-1` | `SCN-53-1` · `02` | `GET /consumers` · `GET .../observations?limit=500` | `knowledge_observation` | `qc/eso-events-ui.test.mjs` (source-invariant) |
| `AC-53-2` | `SCN-53-3…05` | client filter | — | `qc/eso-events-ui.test.mjs` |
| `AC-53-3` | `SCN-53-6` · `07` | `GET .../observations` | `knowledge_observation` | `qc/eso-events-ui.test.mjs` |
| `AC-53-4` | `SCN-53-8` | — | — | `qc/eso-events-ui.test.mjs` |
| `AC-53-5` | `SCN-53-9` | `GET .../observations/stream` (SSE) | `knowledge_observation` | `qc/eso-events-ui.test.mjs` |
| `AC-53-6` | `SCN-53-10` | — | — | `qc/eso-events-ui.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **6/6** |
| `AC` có test chạy được | **6/6** — source-invariant (`node --test` xanh) |
