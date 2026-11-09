---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-16.md"
status: DRAFT
phase: 1
id: SCN-16
type: scenario-matrix
---

# SCN-16 — Scenario matrix cho `AC-16` (Envelope lỗi thống nhất)

**US:** [`US-16`](../01.us/US-16.md) · **AC:** [`AC-16`](../02.ac/AC-16.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-16-1` | `AC-16-1` | happy | request hợp lệ | bất kỳ API | response thành công không có `code` lỗi | yes | `planned` |
| `SCN-16-2` | `AC-16-2` | failure | request sai | gọi API lỗi | body `{code,message}` + status đúng | yes | `planned` |
| `SCN-16-3` | `AC-16-3` | failure | mã lỗi tự chế | review | mã phải có trong BRD/06 | yes | `planned` |
| `SCN-16-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — GĐ1 chỉ một operator |
| `SCN-16-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
