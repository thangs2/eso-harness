---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-06.md"
status: DRAFT
phase: 1
id: SCN-06
type: scenario-matrix
---

# SCN-06 — Scenario matrix cho `AC-06` (Sửa profile có version)

**US:** [`US-06`](../01.us/US-06.md) · **AC:** [`AC-06`](../02.ac/AC-06.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-06-1` | `AC-06-1` | happy | version hiện tại = 3 | PUT với `expected_version=3` | 200, version 4 | yes | `planned` |
| `SCN-06-2` | `AC-06-2` | failure | version hiện tại = 4 | PUT với `expected_version=3` | 409 `STALE_VERSION` | yes | `planned` |
| `SCN-06-3` | `AC-06-3` | failure | body có `id` khác | PUT | 400 `INVALID_CONSUMER_ID` | yes | `planned` |
| `SCN-06-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-06-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
