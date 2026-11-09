---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-13.md"
status: DRAFT
phase: 1
id: SCN-13
type: scenario-matrix
---

# SCN-13 — Scenario matrix cho `AC-13` (Từ chối consumer không hợp lệ)

**US:** [`US-13`](../01.us/US-13.md) · **AC:** [`AC-13`](../02.ac/AC-13.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-13-1` | `AC-13-1` | failure | consumer không tồn tại | gọi `/c/<id>/...` | 404 `CONSUMER_NOT_FOUND` | yes | `planned` |
| `SCN-13-2` | `AC-13-2` | failure | consumer `retired`/`deleted`,`purged` | gọi route | 404 như trên | yes | `planned` |
| `SCN-13-3` | `AC-13-3` | failure | slug sai (`c_b`, `%2e%2e`) | gọi route | 400 `INVALID_CONSUMER_ID` | yes | `planned` |
| `SCN-13-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-13-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
