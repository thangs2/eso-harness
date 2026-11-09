---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-35.md"
status: DRAFT
phase: 1
id: SCN-35
type: scenario-matrix
---

# SCN-35 — Scenario matrix cho `AC-35` (Quan hệ HUMAN/AI)

**US:** [`US-35`](../01.us/US-35.md) · **AC:** [`AC-35`](../02.ac/AC-35.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-35-1` | `AC-35-1` | happy | 2 lớp khớp | kiểm | 100% resolve | yes | `planned` |
| `SCN-35-2` | `AC-35-2` | failure | chép nguyên văn | kiểm | `DOC_CONTRACT_VIOLATION` | yes | `planned` |
| `SCN-35-3` | `AC-35-3` | edge | mục AI mồ côi | kiểm | finding mồ côi | yes | `planned` |
| `SCN-35-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — Bootstrap chỉ một operator |
| `SCN-35-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
