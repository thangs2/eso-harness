---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-04.md"
status: DRAFT
phase: 1
id: SCN-04
type: scenario-matrix
---

# SCN-04 — Scenario matrix cho `AC-04` (Danh sách consumer)

**US:** [`US-04`](../01.us/US-04.md) · **AC:** [`AC-04`](../02.ac/AC-04.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-04-1` | `AC-04-1` | happy | có 2 consumer `ready` | `GET /api/v1/consumers` | 200, cả hai | yes | `planned` |
| `SCN-04-2` | `AC-04-2` | edge | 1 `retired` | list mặc định | vẫn thấy consumer retired | yes | `planned` |
| `SCN-04-3` | `AC-04-3` | edge | 1 `deleted` | list mặc định | không thấy; `?include_deleted=true` thấy | yes | `planned` |
| `SCN-04-4` | `AC-04-4` | happy | 3 consumer (2 ready, 1 retired) | tải trang | 3 số = 3 · 2 · max(updatedAt) | yes | `planned` |
| `SCN-04-5` | `AC-04-5` | happy | 1 ready + 1 retired | chọn `ready` | chỉ còn 1 dòng ready | yes | `planned` |
| `SCN-04-6` | `AC-04-5` | edge | 2 consumer, không có `retired` | chọn `retired` | empty "No consumers match this filter"; 3 số **không** đổi | yes | `planned` |
| `SCN-04-7` | `AC-04-6` | happy | 1 consumer ready | xem dòng | có `Details` + `Events`; `Create consumer` → `/setup` | yes | `planned` |
| `SCN-04-8` | `AC-04-7` | failure | API 500 | tải trang | `CONS_UPSTREAM_FAILED` + message | yes | `planned` |
| `SCN-04-9` | `AC-04-7` | rbac | 401/403 | tải trang | `CONS_DENIED` + message | yes | `planned` |
| `SCN-04-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-04-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- Cardinality: **1 `AC` → n `SCN`** (mỗi tình huống một dòng).
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
