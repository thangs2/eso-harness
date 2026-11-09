---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-03.md"
status: DRAFT
phase: 1
id: SCN-03
type: scenario-matrix
---

# SCN-03 — Scenario matrix cho `AC-03` (Từ chối đăng ký sai)

**US:** [`US-03`](../01.us/US-03.md) · **AC:** [`AC-03`](../02.ac/AC-03.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-03-1` | `AC-03-1` | failure | id 1 ký tự / có dấu cách | đăng ký | 400 `INVALID_CONSUMER_ID` | yes | `planned` |
| `SCN-03-2` | `AC-03-2` | failure | id đã tồn tại (kể cả đã xoá) | đăng ký | 409 `CONSUMER_EXISTS` | yes | `planned` |
| `SCN-03-3` | `AC-03-3` | failure | root là file | đăng ký | 422 `ROOT_NOT_FOUND` | yes | `planned` |
| `SCN-03-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-03-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
