---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-36.md"
status: DRAFT
phase: 1
id: SCN-36
type: scenario-matrix
---

# SCN-36 — Scenario matrix cho `AC-36` (Evidence ingest từ host)

**US:** [`US-36`](../01.us/US-36.md) · **AC:** [`AC-36`](../02.ac/AC-36.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-36-1` | `AC-36-1` | happy | consumer `ready`, 2 event hợp lệ | `POST /v1/ingest/events` | `202` accepted=2; record append-only | yes | `planned` |
| `SCN-36-2` | `AC-36-2` | edge | `E1` đã ingest | gửi lại `E1` | `202` duplicate=1; không record mới | yes | `planned` |
| `SCN-36-3` | `AC-36-3` | failure | schema lạ/quá size | gọi ingest | `400/413`; không ghi | yes | `planned` |
| `SCN-36-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — chưa có account DB (D-111) |
| `SCN-36-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
