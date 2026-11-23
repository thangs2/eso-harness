---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-52.md"
status: DRAFT
phase: 1
id: SCN-52
type: scenario-matrix
---

# SCN-52 — kịch bản `AC-52`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-52-1` | `AC-52-1` | failure | task ngoài scope, có thật | hỏi | `OUT_OF_SCOPE` | yes |
| `SCN-52-2` | `AC-52-2` | failure | task ngoài scope, bịa | hỏi | cùng code + cùng message | yes |
| `SCN-52-3` | `AC-52-3` | happy | task trong scope + store | hỏi | allowed + task | yes |
| `SCN-52-4` | `AC-52-3` | edge | task trong scope, không store | hỏi | placeholder `IN_SCOPE` | yes |
| `SCN-52-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
