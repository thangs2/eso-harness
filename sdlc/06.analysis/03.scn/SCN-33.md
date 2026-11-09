---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-33.md"
status: DRAFT
phase: 1
id: SCN-33
type: scenario-matrix
---

# SCN-33 — Scenario matrix cho `AC-33` (Authority)

**US:** [`US-33`](../01.us/US-33.md) · **AC:** [`AC-33`](../02.ac/AC-33.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-33-1` | `AC-33-1` | happy | operator duyệt | duyệt | allowed + event | yes | `planned` |
| `SCN-33-2` | `AC-33-2` | failure | máy gọi Done | thử | denied + `FORBIDDEN_ACTOR` | yes | `planned` |
| `SCN-33-3` | `AC-33-3` | failure | không rõ actor | thử | `UNKNOWN_ACTOR` | yes | `planned` |
| `SCN-33-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-33-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
