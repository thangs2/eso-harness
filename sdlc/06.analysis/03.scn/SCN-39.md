---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-39.md"
status: DRAFT
phase: 1
id: SCN-39
type: scenario-matrix
---

# SCN-39 — Scenario matrix cho `AC-39` (Host-first setup wizard)

**US:** [`US-39`](../01.us/US-39.md) · **AC:** [`AC-39`](../02.ac/AC-39.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-39-1` | `AC-39-1` | happy | operator login | host → source → consumer → observe → preview → apply | source hợp host; consumer 4 field; profile `ready` | yes | `planned` |
| `SCN-39-2` | `AC-39-2` | edge | `eso-native` chưa build / source không hợp host | mở bước source | option disable + lý do; không apply | yes | `planned` |
| `SCN-39-3` | `AC-39-3` | failure | thiếu id/root hoặc chưa preview | submit/apply | lỗi field/`PREVIEW_REQUIRED`; không ghi | yes | `planned` |
| `SCN-39-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — chưa có account DB (D-111) |
| `SCN-39-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
