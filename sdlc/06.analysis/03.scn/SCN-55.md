---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-55.md"
status: DRAFT
phase: 1
id: SCN-55
type: scenario-matrix
---

# SCN-55 — kịch bản `AC-55`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-55-1` | `AC-55-1` | happy | consumer A | switch → B | tab nạp cho B | yes |
| `SCN-55-2` | `AC-55-2` | happy | clean | xem footer | `All changes saved`, Save disabled | yes |
| `SCN-55-3` | `AC-55-2` | edge | sửa 1 field | xem footer | `Unsaved changes`, Save enabled | yes |
| `SCN-55-4` | `AC-55-3` | edge | workers lỗi validate | Save | disabled | yes |
| `SCN-55-5` | `AC-55-4` | edge | conflict còn | xem apply | `Resolve conflicts first` | yes |
| `SCN-55-6` | `AC-55-5` | edge | legacy archive | bấm archive | confirm trước | yes |
| `SCN-55-TENANT-OUT` | — | tenant | — | — | `OUT` | — |
