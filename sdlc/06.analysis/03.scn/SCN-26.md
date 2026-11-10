---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-26.md"
status: DRAFT
phase: 1
id: SCN-26
type: scenario-matrix
---

# SCN-26 — Scenario matrix cho `AC-26` (Scope check)

**US:** [`US-26`](../01.us/US-26.md) · **AC:** [`AC-26`](../02.ac/AC-26.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-26-1` | `AC-26-1` | happy | path trong allowed | kiểm | allowed | yes | `planned` |
| `SCN-26-2` | `AC-26-2` | failure | path ngoài allowed | kiểm | denied + violation | yes | `planned` |
| `SCN-26-3` | `AC-26-3` | failure | path sang consumer khác | kiểm | denied | yes | `planned` |
| `SCN-26-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-26-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
