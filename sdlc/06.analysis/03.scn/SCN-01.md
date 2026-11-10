---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-01.md"
status: DRAFT
phase: 1
id: SCN-01
type: scenario-matrix
---

# SCN-01 — Scenario matrix cho `AC-01` (Đăng nhập control plane)

**US:** [`US-01`](../01.us/US-01.md) · **AC:** [`AC-01`](../02.ac/AC-01.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-01-1` | `AC-01-1` | happy | có credential đúng trong `.env` | gọi `/api/v1/auth/me` | 200 + `kind=operator` | yes | `planned` |
| `SCN-01-2` | `AC-01-2` | edge | dùng `ESO_API_TOKEN` | gọi API registry bằng Bearer | 200 như Basic | yes | `planned` |
| `SCN-01-3` | `AC-01-3` | failure | không có header | gọi API bất kỳ | 401 `AUTH_REQUIRED` | yes | `planned` |
| `SCN-01-4` | `AC-01-4` | failure | sai user/pass | gọi API | 401 `AUTH_INVALID` | yes | `planned` |
| `SCN-01-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-01-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
