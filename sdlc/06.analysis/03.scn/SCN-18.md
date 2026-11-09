---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-18.md"
status: DRAFT
phase: 1
id: SCN-18
type: scenario-matrix
---

# SCN-18 — Scenario matrix cho `AC-18` (Giải thích vì sao)

**US:** [`US-18`](../01.us/US-18.md) · **AC:** [`AC-18`](../02.ac/AC-18.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-18-1` | `AC-18-1` | happy | verdict tồn tại | mở giải thích | có `why` + requirements | yes | `planned` |
| `SCN-18-2` | `AC-18-2` | failure | verdict không tồn tại | mở giải thích | 404 | yes | `planned` |
| `SCN-18-3` | `AC-18-3` | edge | không có gap | mở giải thích | `gaps[]` rỗng + lý do | yes | `planned` |
| `SCN-18-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-18-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
