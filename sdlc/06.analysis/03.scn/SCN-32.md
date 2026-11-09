---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-32.md"
status: DRAFT
phase: 1
id: SCN-32
type: scenario-matrix
---

# SCN-32 — Scenario matrix cho `AC-32` (Tự nâng skill có duyệt)

**US:** [`US-32`](../01.us/US-32.md) · **AC:** [`AC-32`](../02.ac/AC-32.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-32-1` | `AC-32-1` | happy | proposal có diff | gửi | `proposed` | yes | `planned` |
| `SCN-32-2` | `AC-32-2` | happy | người duyệt | duyệt | `applied` + đo | yes | `planned` |
| `SCN-32-3` | `AC-32-3` | failure | agent tự duyệt | thử | `NEEDS_APPROVAL` | yes | `planned` |
| `SCN-32-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-32-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
