---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-29.md"
status: DRAFT
phase: 1
id: SCN-29
type: scenario-matrix
---

# SCN-29 — Scenario matrix cho `AC-29` (Kiến trúc microservices)

**US:** [`US-29`](../01.us/US-29.md) · **AC:** [`AC-29`](../02.ac/AC-29.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-29-1` | `AC-29-1` | happy | graph service/event | hỏi 4 nhóm | trả lời kèm chứng | yes | `planned` |
| `SCN-29-2` | `AC-29-2` | edge | thiếu dữ liệu | hỏi | `unknown` | yes | `planned` |
| `SCN-29-3` | `AC-29-3` | failure | kết luận không chứng | review | `DOC_CONTRACT_VIOLATION` | yes | `planned` |
| `SCN-29-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-29-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
