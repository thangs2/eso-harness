---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-23.md"
status: DRAFT
phase: 1
id: SCN-23
type: scenario-matrix
---

# SCN-23 — Scenario matrix cho `AC-23` (Sufficiency nội dung)

**US:** [`US-23`](../01.us/US-23.md) · **AC:** [`AC-23`](../02.ac/AC-23.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-23-1` | `AC-23-1` | happy | 2 bản gần trùng | kiểm | `NEAR_DUPLICATE` + copies | yes | `planned` |
| `SCN-23-2` | `AC-23-2` | failure | 2 bản mâu thuẫn | kiểm | `CONTENT_CONTRADICTS` | yes | `planned` |
| `SCN-23-3` | `AC-23-3` | edge | finding không hậu quả | kiểm | bị loại | yes | `planned` |
| `SCN-23-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-23-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
