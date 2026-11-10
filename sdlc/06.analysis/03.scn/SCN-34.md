---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-34.md"
status: DRAFT
phase: 1
id: SCN-34
type: scenario-matrix
---

# SCN-34 — Scenario matrix cho `AC-34` (Bề mặt S1–S5)

**US:** [`US-34`](../01.us/US-34.md) · **AC:** [`AC-34`](../02.ac/AC-34.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-34-1` | `AC-34-1` | happy | có dữ liệu | mở S1/S2/S5 | trả lời được | yes | `planned` |
| `SCN-34-2` | `AC-34-2` | edge | chưa có dữ liệu | mở | `empty` + lý do | yes | `planned` |
| `SCN-34-3` | `AC-34-3` | failure | số không nguồn | review | bị chặn | yes | `planned` |
| `SCN-34-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-34-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
