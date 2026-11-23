---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-45.md"
status: DRAFT
phase: 1
id: SCN-45
type: scenario-matrix
---

# SCN-45 — kịch bản `AC-45`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-45-1` | `AC-45-1` | happy | source = projection | mở tab | in sync, không drift | yes |
| `SCN-45-2` | `AC-45-1` | edge | lệch 1 file | mở tab | drift list file + kind | yes |
| `SCN-45-3` | `AC-45-2` | happy | có drift | Sync sources | index rebuild, flow không đổi | yes |
| `SCN-45-4` | `AC-45-3` | edge | 1 projection lệch | Promote | source đổi + reindex | yes |
| `SCN-45-5` | `AC-45-4` | rbac | 401/403 | status/sync | `WORKER_SYNC_DENIED` | yes |
| `SCN-45-6` | `AC-45-4` | failure | 5xx | sync | `WORKER_SYNC_FAILED` | yes |
| `SCN-45-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
