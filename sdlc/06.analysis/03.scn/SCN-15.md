---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-15.md"
status: DRAFT
phase: 1
id: SCN-15
type: scenario-matrix
---

# SCN-15 — Scenario matrix cho `AC-15` (Dùng control plane qua UI)

**US:** [`US-15`](../01.us/US-15.md) · **AC:** [`AC-15`](../02.ac/AC-15.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-15-1` | `AC-15-1` | happy | có credential | mở UI, đăng nhập | thấy danh sách consumer | no (smoke tay) | `planned` |
| `SCN-15-2` | `AC-15-2` | happy | đã đăng nhập | đăng ký qua wizard | consumer mới xuất hiện trong list | no (smoke tay) | `planned` |
| `SCN-15-3` | `AC-15-3` | edge | server trả lỗi | bấm nút | UI hiện mã lỗi + message | no (smoke tay) | `planned` |
| `SCN-15-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-15-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
