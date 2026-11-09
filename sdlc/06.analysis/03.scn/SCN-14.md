---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-14.md"
status: DRAFT
phase: 1
id: SCN-14
type: scenario-matrix
---

# SCN-14 — Scenario matrix cho `AC-14` (Audit consumer)

**US:** [`US-14`](../01.us/US-14.md) · **AC:** [`AC-14`](../02.ac/AC-14.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-14-1` | `AC-14-1` | happy | tạo consumer | xem `/events` | có event `created` + actor + thời điểm | yes | `planned` |
| `SCN-14-2` | `AC-14-2` | happy | retire/delete/purge | làm lần lượt | 4 event tương ứng | yes | `planned` |
| `SCN-14-3` | `AC-14-3` | failure | gọi `DELETE /events/...` | thử xoá | 405/404 (không có endpoint) | yes | `planned` |
| `SCN-14-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-14-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
