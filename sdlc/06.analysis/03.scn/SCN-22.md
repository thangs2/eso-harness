---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-22.md"
status: DRAFT
phase: 1
id: SCN-22
type: scenario-matrix
---

# SCN-22 — Scenario matrix cho `AC-22` (Inventory artifact)

**US:** [`US-22`](../01.us/US-22.md) · **AC:** [`AC-22`](../02.ac/AC-22.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-22-1` | `AC-22-1` | happy | KB có đủ kind | inventory | mỗi kind có instance | yes | `planned` |
| `SCN-22-2` | `AC-22-2` | failure | kind bắt buộc thiếu | inventory | `MISSING_KIND` | yes | `planned` |
| `SCN-22-3` | `AC-22-3` | edge | artifact mồ côi | inventory | finding mồ côi | yes | `planned` |
| `SCN-22-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-22-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
