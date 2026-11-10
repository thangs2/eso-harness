---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-41.md"
status: DRAFT
phase: 1
id: SCN-41
type: scenario-matrix
---

# SCN-41 — Scenario matrix cho `AC-41` (Host sync)

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-41-1` | `AC-41-1` | happy | canonical có, chọn 2 host | sync | projection; version không đổi | yes | `planned` |
| `SCN-41-2` | `AC-41-2` | edge | đã sync, có file user | thêm host | merge; file user còn | yes | `planned` |
| `SCN-41-3` | `AC-41-3` | failure | canonical thiếu/host lạ | sync | fail closed | yes | `planned` |
| `SCN-41-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — chưa có account DB (D-111) |
| `SCN-41-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`; viết trước code, chạy sau `tdd-impl`.
