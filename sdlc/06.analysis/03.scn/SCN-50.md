---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-50.md"
status: DRAFT
phase: 1
id: SCN-50
type: scenario-matrix
---

# SCN-50 — kịch bản `AC-50`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-50-1` | `AC-50-1` | happy | `['src/**']` | ghi `src/a.ts` | allowed, write 1 lần | yes |
| `SCN-50-2` | `AC-50-1` | edge | `['src/*.ts']` | ghi `src/deep/a.ts` | `BLOCKED_SCOPE` (glob không khớp) | yes |
| `SCN-50-3` | `AC-50-2` | failure | `['src/**']` | ghi `docs/a.md` | `BLOCKED_SCOPE` + log, không ghi | yes |
| `SCN-50-4` | `AC-50-3` | edge | `[]` | ghi bất kỳ | `EMPTY_SCOPE` | yes |
| `SCN-50-5` | `AC-50-4` | edge | dir không tồn tại | ghi | `DANGLING_SCOPE` | yes |
| `SCN-50-6` | `AC-50-5` | rbac | agent + in-progress | set `Done` | `DONE_FORBIDDEN` | yes |
| `SCN-50-7` | `AC-50-5` | happy | human + in-progress | set `Done` | cho phép | yes |
| `SCN-50-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
