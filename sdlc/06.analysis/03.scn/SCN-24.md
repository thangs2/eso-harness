---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-24.md"
status: DRAFT
phase: 1
id: SCN-24
type: scenario-matrix
---

# SCN-24 — Scenario matrix cho `AC-24` (Transfer tri thức)

**US:** [`US-24`](../01.us/US-24.md) · **AC:** [`AC-24`](../02.ac/AC-24.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-24-1` | `AC-24-1` | happy | proposal có nguồn | gửi | `proposed` | yes | `planned` |
| `SCN-24-2` | `AC-24-2` | happy | người duyệt | duyệt | `approved` + entry | yes | `planned` |
| `SCN-24-3` | `AC-24-3` | failure | agent duyệt | thử | `NEEDS_APPROVAL` | yes | `planned` |
| `SCN-24-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-24-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
