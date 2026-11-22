---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-02.md"
status: DRAFT
phase: 1
id: SCN-02
type: scenario-matrix
---

# SCN-02 — Scenario matrix cho `AC-02` (Đăng ký consumer)

**US:** [`US-02`](../01.us/US-02.md) · **AC:** [`AC-02`](../02.ac/AC-02.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-02-1` | `AC-02-1` | happy | root tồn tại, id chưa có | `POST /api/v1/consumers` | 201 + record `ready` version 1 | yes | `planned` |
| `SCN-02-2` | `AC-02-2` | edge | root là thư mục rỗng | đăng ký | 201 | yes | `planned` |
| `SCN-02-3` | `AC-02-3` | failure | root không tồn tại | đăng ký | 422 `ROOT_NOT_FOUND` | yes | `planned` |
| `SCN-02-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-02-4` | `AC-02-4` | happy | đủ dữ liệu 4 bước | điền và xem Preview | preview đúng, chưa ghi | yes | `planned` |
| `SCN-02-5` | `AC-02-5` | failure | bước 1/2 thiếu trường | Next/Apply | mã tương ứng; không qua bước | yes | `planned` |
| `SCN-02-6` | `AC-02-6` | failure | consent off | chọn JEV shadow | `SETUP_JEV_NEEDS_CONSENT`; chặn submit | yes | `planned` |
| `SCN-02-7` | `AC-02-7` | edge | folder ngoài FS root / trùng tên | chọn folder | `SETUP_ROOT_UNRESOLVED` / `SETUP_ROOT_AMBIGUOUS` | yes | `planned` |
| `SCN-02-8` | `AC-02-8` | rbac | 401/403 | Apply | `SETUP_DENIED` | yes | `planned` |
| `SCN-02-9` | `AC-02-8` | failure | 5xx | Apply | `SETUP_UPSTREAM_FAILED`; giữ dữ liệu | yes | `planned` |
| `SCN-02-10` | `AC-02-8` | happy | server 201 | Apply | chuyển `/consumers/:id?created=1` | yes | `planned` |
| `SCN-02-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
