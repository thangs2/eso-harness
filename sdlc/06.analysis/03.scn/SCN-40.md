---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-40.md"
status: DRAFT
phase: 1
id: SCN-40
type: scenario-matrix
---

# SCN-40 — Scenario matrix cho `AC-40` (Consumer provisioning)

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-40-1` | `AC-40-1` | happy | consumer ready | provision | schema + material + info read-back | yes | `planned` |
| `SCN-40-2` | `AC-40-2` | edge | đã provision | chạy lại | idempotent; không duplicate | yes | `planned` |
| `SCN-40-3` | `AC-40-3` | failure | id/schema lệch | provision | error, fail closed | yes | `planned` |
| `SCN-40-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — chưa có account DB (D-111) |
| `SCN-40-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`; viết trước code, chạy sau `tdd-impl`.
