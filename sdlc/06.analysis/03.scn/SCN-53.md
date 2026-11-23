---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-53.md"
status: DRAFT
phase: 1
id: SCN-53
type: scenario-matrix
---

# SCN-53 — kịch bản `AC-53`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-53-1` | `AC-53-1` | happy | 20 event | mở trang | list 20 | yes |
| `SCN-53-2` | `AC-53-1` | edge | 0 event | mở trang | empty + lý do | yes |
| `SCN-53-3` | `AC-53-2` | happy | nhiều event | lọc event/outcome | đúng tập | yes |
| `SCN-53-4` | `AC-53-2` | edge | trace cụ thể | nhập trace | khớp chính xác trước | yes |
| `SCN-53-5` | `AC-53-2` | edge | order desc/asc | đổi order | đảo thứ tự | yes |
| `SCN-53-6` | `AC-53-3` | happy | event có request | chọn | detail, không prompt body | yes |
| `SCN-53-7` | `AC-53-4` | rbac | 401/403 | mở | `OBS_DENIED` | yes |
| `SCN-53-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
