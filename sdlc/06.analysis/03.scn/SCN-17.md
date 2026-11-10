---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-17.md"
status: DRAFT
phase: 1
id: SCN-17
type: scenario-matrix
---

# SCN-17 — Scenario matrix cho `AC-17` (Verdict trước khi thực thi)

**US:** [`US-17`](../01.us/US-17.md) · **AC:** [`AC-17`](../02.ac/AC-17.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-17-1` | `AC-17-1` | happy | có evidence đủ | gọi verdict | trả `level` + `basis` + `mode` | yes | `planned` |
| `SCN-17-2` | `AC-17-2` | failure | evidence thiếu | gọi verdict | `missing[]` nêu thiếu | yes | `planned` |
| `SCN-17-3` | `AC-17-3` | edge | cannot-judge | gọi verdict | `mode` = ask/block | yes | `planned` |
| `SCN-17-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — baseline chỉ một operator |
| `SCN-17-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
