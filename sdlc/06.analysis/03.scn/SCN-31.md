---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-31.md"
status: DRAFT
phase: 1
id: SCN-31
type: scenario-matrix
---

# SCN-31 — Scenario matrix cho `AC-31` (Host parity)

**US:** [`US-31`](../01.us/US-31.md) · **AC:** [`AC-31`](../02.ac/AC-31.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-31-1` | `AC-31-1` | happy | 2 host đủ năng lực | chạy | parity | yes | `planned` |
| `SCN-31-2` | `AC-31-2` | edge | 1 host thiếu | chạy | khác biệt có lý do `none` | yes | `planned` |
| `SCN-31-3` | `AC-31-3` | failure | khác biệt không lý do | chạy | finding parity | yes | `planned` |
| `SCN-31-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-31-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
