---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-12.md"
status: DRAFT
phase: 1
id: SCN-12
type: scenario-matrix
---

# SCN-12 — Scenario matrix cho `AC-12` (Cô lập dữ liệu consumer)

**US:** [`US-12`](../01.us/US-12.md) · **AC:** [`AC-12`](../02.ac/AC-12.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-12-1` | `AC-12-1` | happy | 2 consumer A/B có dữ liệu | gọi route A rồi B | mỗi bên chỉ thấy dữ liệu của mình | yes | `planned` |
| `SCN-12-2` | `AC-12-2` | edge | cùng connection pool | A rồi B | B không thấy A | yes | `planned` |
| `SCN-12-3` | `AC-12-3` | edge | path injection `../b` | gọi route | 400/404 | yes | `planned` |
| `SCN-12-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-12-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
