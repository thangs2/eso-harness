---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-27.md"
status: DRAFT
phase: 1
id: SCN-27
type: scenario-matrix
---

# SCN-27 — Scenario matrix cho `AC-27` (Sufficiency per-actor)

**US:** [`US-27`](../01.us/US-27.md) · **AC:** [`AC-27`](../02.ac/AC-27.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-27-1` | `AC-27-1` | happy | actor có identity | hỏi | verdict theo role | yes | `planned` |
| `SCN-27-2` | `AC-27-2` | failure | không identity | hỏi | `UNKNOWN_ACTOR` + nêu rõ | yes | `planned` |
| `SCN-27-3` | `AC-27-3` | edge | 2 role khác nhau | hỏi cùng task | kết quả khác là đúng | yes | `planned` |
| `SCN-27-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-27-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
