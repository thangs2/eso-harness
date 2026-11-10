---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-21.md"
status: DRAFT
phase: 1
id: SCN-21
type: scenario-matrix
---

# SCN-21 — Scenario matrix cho `AC-21` (Chọn tri thức theo applies_when)

**US:** [`US-21`](../01.us/US-21.md) · **AC:** [`AC-21`](../02.ac/AC-21.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-21-1` | `AC-21-1` | happy | task khớp 2 entry | chọn | selected 2 + lý do | yes | `planned` |
| `SCN-21-2` | `AC-21-2` | edge | không khớp | chọn | `no-match` | yes | `planned` |
| `SCN-21-3` | `AC-21-3` | edge | KB rỗng | chọn | `no-match` | yes | `planned` |
| `SCN-21-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-21-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
