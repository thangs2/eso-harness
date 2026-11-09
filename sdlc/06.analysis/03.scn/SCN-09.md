---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-09.md"
status: DRAFT
phase: 1
id: SCN-09
type: scenario-matrix
---

# SCN-09 — Scenario matrix cho `AC-09` (Purge consumer)

**US:** [`US-09`](../01.us/US-09.md) · **AC:** [`AC-09`](../02.ac/AC-09.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-09-1` | `AC-09-1` | happy | consumer `deleted`, gõ đúng id | `POST .../purge` | 200, `purged` | yes | `planned` |
| `SCN-09-2` | `AC-09-2` | failure | consumer `ready` | purge | 409 `INVALID_STATE` | yes | `planned` |
| `SCN-09-3` | `AC-09-3` | failure | `confirm_id` sai | purge | 409 `PURGE_CONFIRM_MISMATCH` | yes | `planned` |
| `SCN-09-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-09-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
