---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-47.md"
status: DRAFT
phase: 1
id: SCN-47
type: scenario-matrix
---

# SCN-47 — kịch bản `AC-47`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-47-1` | `AC-47-1` | happy | 3 doc | mở tab | list 3 row | yes |
| `SCN-47-2` | `AC-47-1` | edge | 0 doc | mở tab | "no document indexed" | yes |
| `SCN-47-3` | `AC-47-2` | happy | summary 3/5/2 | mở tab | 3 số đúng | yes |
| `SCN-47-4` | `AC-47-2` | edge | thiếu field | mở tab | `—`, không suy 0 | yes |
| `SCN-47-5` | `AC-47-3` | edge | check FAIL 4 | mở tab | FAIL + 4 checks | yes |
| `SCN-47-6` | `AC-47-4` | rbac | 401/403 | mở tab | mã + message, không số giả | yes |
| `SCN-47-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
