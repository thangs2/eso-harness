---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-07.md"
status: DRAFT
phase: 1
id: SCN-07
type: scenario-matrix
---

# SCN-07 — Scenario matrix cho `AC-07` (Retire / reactivate consumer)

**US:** [`US-07`](../01.us/US-07.md) · **AC:** [`AC-07`](../02.ac/AC-07.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-07-1` | `AC-07-1` | happy | consumer `ready` | `POST .../retire` | 200, status `retired` | yes | `planned` |
| `SCN-07-2` | `AC-07-2` | edge | consumer `retired` | gọi route dữ liệu `/c/<id>/...` | 404 `CONSUMER_NOT_FOUND` | yes | `planned` |
| `SCN-07-3` | `AC-07-3` | happy | consumer `retired` | `POST .../reactivate` | 200, `ready` | yes | `planned` |
| `SCN-07-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-07-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
