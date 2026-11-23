---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-51.md"
status: DRAFT
phase: 1
id: SCN-51
type: scenario-matrix
---

# SCN-51 — kịch bản `AC-51`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-51-1` | `AC-51-1` | happy | due +1h | accept | accepted + event + remaining>0 | yes |
| `SCN-51-2` | `AC-51-2` | failure | due rỗng | accept | `ACCEPT_NO_DUE` | yes |
| `SCN-51-3` | `AC-51-2` | failure | due đã qua | accept | `EXPIRED_DUE_DATE` | yes |
| `SCN-51-4` | `AC-51-3` | rbac | kind ngoài quyền | accept | `FORBIDDEN_ACCEPT` + audit | yes |
| `SCN-51-5` | `AC-51-4` | edge | đã accepted | accept lần 2 | `ALREADY_ACCEPTED` | yes |
| `SCN-51-6` | `AC-51-5` | edge | now = due | inspect | `accepted` | yes |
| `SCN-51-7` | `AC-51-5` | edge | now > due | inspect | `expired` + event | yes |
| `SCN-51-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
