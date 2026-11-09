---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-10.md"
status: DRAFT
phase: 1
id: SCN-10
type: scenario-matrix
---

# SCN-10 — Scenario matrix cho `AC-10` (Materialize profile)

**US:** [`US-10`](../01.us/US-10.md) · **AC:** [`AC-10`](../02.ac/AC-10.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-10-1` | `AC-10-1` | happy | consumer `ready` | materialize | file tồn tại, có `_generated` + `hash` | yes | `planned` |
| `SCN-10-2` | `AC-10-2` | edge | materialize lần 2 | materialize lại | file giống hệt (idempotent) | yes | `planned` |
| `SCN-10-3` | `AC-10-3` | failure | root bị xoá | materialize | 422 `ROOT_NOT_FOUND` | yes | `planned` |
| `SCN-10-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-10-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
