---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-37.md"
status: DRAFT
phase: 1
id: SCN-37
type: scenario-matrix
---

# SCN-37 — Scenario matrix cho `AC-37` (Harness adapter packaging)

**US:** [`US-37`](../01.us/US-37.md) · **AC:** [`AC-37`](../02.ac/AC-37.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-37-1` | `AC-37-1` | happy | repo có `eso/harness/` | build/scan package | đủ layout; core không import host SDK | yes | `planned` |
| `SCN-37-2` | `AC-37-2` | edge | adapter mới có manifest/entrypoint | chạy conformance | pass + capability khai | yes | `planned` |
| `SCN-37-3` | `AC-37-3` | failure | thiếu manifest/entrypoint | build | `MISSING_MANIFEST`; không publish | yes | `planned` |
| `SCN-37-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — build-time, không có actor runtime |
| `SCN-37-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — package không thuộc consumer |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
