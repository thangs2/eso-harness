---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-19.md"
status: DRAFT
phase: 1
id: SCN-19
type: scenario-matrix
---

# SCN-19 — Scenario matrix cho `AC-19` (Ghi evidence)

**US:** [`US-19`](../01.us/US-19.md) · **AC:** [`AC-19`](../02.ac/AC-19.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-19-1` | `AC-19-1` | happy | evidence hợp lệ | ghi | có id + hash | yes | `planned` |
| `SCN-19-2` | `AC-19-2` | failure | derived không khớp nguồn | ghi | `DOC_CONTRACT_VIOLATION` | yes | `planned` |
| `SCN-19-3` | `AC-19-3` | failure | gọi PUT/DELETE | thử sửa | 405/404 | yes | `planned` |
| `SCN-19-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-19-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
