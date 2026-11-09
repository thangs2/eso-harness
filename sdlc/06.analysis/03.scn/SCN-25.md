---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-25.md"
status: DRAFT
phase: 1
id: SCN-25
type: scenario-matrix
---

# SCN-25 — Scenario matrix cho `AC-25` (Freshness)

**US:** [`US-25`](../01.us/US-25.md) · **AC:** [`AC-25`](../02.ac/AC-25.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-25-1` | `AC-25-1` | happy | tín hiệu khớp | kiểm | `current` | yes | `planned` |
| `SCN-25-2` | `AC-25-2` | failure | nguồn đổi hash | kiểm | `stale` + lý do | yes | `planned` |
| `SCN-25-3` | `AC-25-3` | edge | không tín hiệu | kiểm | `unknown` (không mặc định current) | yes | `planned` |
| `SCN-25-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-25-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
