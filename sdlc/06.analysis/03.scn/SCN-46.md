---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-46.md"
status: DRAFT
phase: 1
id: SCN-46
type: scenario-matrix
---

# SCN-46 — kịch bản `AC-46`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-46-1` | `AC-46-1` | happy | 2 worker | mở tab | list 2 | yes |
| `SCN-46-2` | `AC-46-1` | edge | 0 worker | mở tab | empty + gợi ý import | yes |
| `SCN-46-3` | `AC-46-2` | happy | worker active | sửa identity/prompt + Save | canonical đổi | yes |
| `SCN-46-4` | `AC-46-3` | failure | role/layer/status sai | Save | `WORKER_INVALID` | yes |
| `SCN-46-5` | `AC-46-4` | happy | 2 runtime | chọn allowed + model + Save | placement lưu | yes |
| `SCN-46-6` | `AC-46-5` | edge | 3 file, 1 lạ | preview → apply | 2 candidate, 1 skipped + audit | yes |
| `SCN-46-7` | `AC-46-5` | failure | apply không preview | apply | `WORKER_IMPORT_CONFLICT` | yes |
| `SCN-46-8` | `AC-46-6` | rbac | 401/403 | Save | `WORKER_CONFIG_DENIED` | yes |
| `SCN-46-9` | `AC-46-6` | failure | policy từ chối | check | `WORKER_POLICY_DENIED` | yes |
| `SCN-46-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
