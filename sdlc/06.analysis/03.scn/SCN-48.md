---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-48.md"
status: DRAFT
phase: 1
id: SCN-48
type: scenario-matrix
---

# SCN-48 — kịch bản `AC-48`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-48-1` | `AC-48-1` | happy | 2 policy, enforce | mở tab | 2 dòng + enforcement | yes |
| `SCN-48-2` | `AC-48-1` | edge | 0 policy | mở tab | "no policy" | yes |
| `SCN-48-3` | `AC-48-2` | happy | allow + deny | Save | PUT toàn bộ, deny thắng | yes |
| `SCN-48-4` | `AC-48-3` | edge | writer cần ghi 1 lần | tạo grant write 1h | single-use + expiry | yes |
| `SCN-48-5` | `AC-48-3` | happy | có grant | revoke | grant mất | yes |
| `SCN-48-6` | `AC-48-4` | failure | policy thiếu prefix | Save | `BOUNDARY_INVALID` | yes |
| `SCN-48-7` | `AC-48-4` | rbac | 401/403 | Save | `BOUNDARY_DENIED` | yes |
| `SCN-48-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
