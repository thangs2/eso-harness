---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-30.md"
status: DRAFT
phase: 1
id: SCN-30
type: scenario-matrix
---

# SCN-30 — Scenario matrix cho `AC-30` (Chọn nguồn năng lực host)

**US:** [`US-30`](../01.us/US-30.md) · **AC:** [`AC-30`](../02.ac/AC-30.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-30-1` | `AC-30-1` | happy | host có native | chọn | host-native + reason | yes | `planned` |
| `SCN-30-2` | `AC-30-2` | edge | host thiếu | chọn | `none` + lý do | yes | `planned` |
| `SCN-30-3` | `AC-30-3` | failure | capability lạ | chọn | `UNKNOWN_CAPABILITY` | yes | `planned` |
| `SCN-30-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-30-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
