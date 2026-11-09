---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-28.md"
status: DRAFT
phase: 1
id: SCN-28
type: scenario-matrix
---

# SCN-28 — Scenario matrix cho `AC-28` (Kiến trúc monolith)

**US:** [`US-28`](../01.us/US-28.md) · **AC:** [`AC-28`](../02.ac/AC-28.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-28-1` | `AC-28-1` | happy | graph đã dựng | hỏi | câu trả lời + file:line | yes | `planned` |
| `SCN-28-2` | `AC-28-2` | failure | không đủ dữ liệu | hỏi | `unknown` | yes | `planned` |
| `SCN-28-3` | `AC-28-3` | edge | có vòng phụ thuộc | hỏi | nêu module trong vòng | yes | `planned` |
| `SCN-28-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-28-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
