---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-57.md"
status: DRAFT
phase: 1
id: SCN-57
type: scenario-matrix
---

# SCN-57

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-57-1` | `AC-57-1` | happy | 5 doc | retrieve | why+rrf | yes |
| `SCN-57-2` | `AC-57-2` | edge | vector off | retrieve | reason+FTS | yes |
| `SCN-57-3` | `AC-57-3` | failure | consumer lạ | retrieve | 404 | yes |
| `SCN-57-4` | `AC-57-3` | failure | index off | retrieve | `KNOWLEDGE_DISABLED` | yes |
