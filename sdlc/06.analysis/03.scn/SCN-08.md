---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-08.md"
status: DRAFT
phase: 1
id: SCN-08
type: scenario-matrix
---

# SCN-08 — Scenario matrix cho `AC-08` (Soft delete / restore)

**US:** [`US-08`](../01.us/US-08.md) · **AC:** [`AC-08`](../02.ac/AC-08.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-08-1` | `AC-08-1` | happy | consumer `ready` | `POST .../delete` | 200, `deleted` | yes | `planned` |
| `SCN-08-2` | `AC-08-2` | happy | consumer `deleted` | `POST .../restore` | 200, `ready` | yes | `planned` |
| `SCN-08-3` | `AC-08-3` | failure | consumer `ready` | `POST .../restore` | 409 `INVALID_STATE` | yes | `planned` |
| `SCN-08-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-08-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
