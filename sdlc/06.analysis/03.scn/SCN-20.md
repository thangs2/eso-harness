---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-20.md"
status: DRAFT
phase: 1
id: SCN-20
type: scenario-matrix
---

# SCN-20 — Scenario matrix cho `AC-20` (Memory native)

**US:** [`US-20`](../01.us/US-20.md) · **AC:** [`AC-20`](../02.ac/AC-20.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-20-1` | `AC-20-1` | happy | fact mới | ghi | `proposed` | yes | `planned` |
| `SCN-20-2` | `AC-20-2` | happy | người duyệt | duyệt | `approved` | yes | `planned` |
| `SCN-20-3` | `AC-20-3` | failure | agent tự duyệt | thử | `NEEDS_APPROVAL`/`FORBIDDEN_ACTOR` | yes | `planned` |
| `SCN-20-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-20-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
