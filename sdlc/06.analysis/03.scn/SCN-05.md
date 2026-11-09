---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-05.md"
status: DRAFT
phase: 1
id: SCN-05
type: scenario-matrix
---

# SCN-05 — Scenario matrix cho `AC-05` (Chi tiết consumer)

**US:** [`US-05`](../01.us/US-05.md) · **AC:** [`AC-05`](../02.ac/AC-05.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-05-1` | `AC-05-1` | happy | consumer tồn tại | `GET /api/v1/consumers/{id}` | 200 + đủ trường | yes | `planned` |
| `SCN-05-2` | `AC-05-2` | failure | id không tồn tại | get | 404 `CONSUMER_NOT_FOUND` | yes | `planned` |
| `SCN-05-3` | `AC-05-3` | edge | response chứa profile | in response | không có credential/DSN | yes | `planned` |
| `SCN-05-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-05-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
