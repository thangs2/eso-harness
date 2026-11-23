---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-49.md"
status: DRAFT
phase: 1
id: SCN-49
type: scenario-matrix
---

# SCN-49 — kịch bản `AC-49`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-49-1` | `AC-49-1` | happy | consent on | mở tab | chọn event/JEV được | yes |
| `SCN-49-2` | `AC-49-1` | edge | consent off | mở tab | mọi control disabled | yes |
| `SCN-49-3` | `AC-49-2` | happy | 4 kinds, chọn 2 | Save | lưu 2 event | yes |
| `SCN-49-4` | `AC-49-3` | failure | consent off + JEV shadow | Save | `PROFILE_JEV_NEEDS_CONSENT` | yes |
| `SCN-49-5` | `AC-49-3` | failure | threshold 1.5 | Save | `PROFILE_JEV_THRESHOLD` | yes |
| `SCN-49-6` | `AC-49-4` | happy | có observation | xem timeline | read-only + link `/observatory` | yes |
| `SCN-49-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
