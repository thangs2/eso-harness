---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-11.md"
status: DRAFT
phase: 1
id: SCN-11
type: scenario-matrix
---

# SCN-11 — Scenario matrix cho `AC-11` (Kiểm drift profile)

**US:** [`US-11`](../01.us/US-11.md) · **AC:** [`AC-11`](../02.ac/AC-11.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-11-1` | `AC-11-1` | happy | file khớp DB | check | `ok` | yes | `planned` |
| `SCN-11-2` | `AC-11-2` | failure | sửa tay 1 trường | check | `drift` + hash mong đợi/thực tế | yes | `planned` |
| `SCN-11-3` | `AC-11-3` | edge | xoá file | check | `missing` | yes | `planned` |
| `SCN-11-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-11-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
