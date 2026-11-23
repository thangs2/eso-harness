---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-43.md"
status: DRAFT
phase: 1
id: SCN-43
type: scenario-matrix
---

# SCN-43 — kịch bản `AC-43`

**AC:** [`AC-43`](../02.ac/AC-43.md)
> Cardinality: **1 `AC` → n `SCN`**.

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-43-1` | `AC-43-1` | happy | 2 version, 1 active | mở tab | active + list 2 | yes |
| `SCN-43-2` | `AC-43-1` | edge | consumer mới | mở tab | rỗng | yes |
| `SCN-43-3` | `AC-43-2` | happy | v2 active | bật layer + Save | PUT toàn bộ, đổi DB | yes |
| `SCN-43-4` | `AC-43-3` | edge | v1 published | sửa v1 + Save | `STACK_VERSION_IMMUTABLE` | yes |
| `SCN-43-5` | `AC-43-4` | edge | có conflict rules | import | preview rồi mới ghi | yes |
| `SCN-43-6` | `AC-43-4` | failure | conflict chưa chọn | import | `RULES_IMPORT_CONFLICT` | yes |
| `SCN-43-7` | `AC-43-5` | rbac | 401/403 | load/save | `STACK_DENIED` | yes |
| `SCN-43-8` | `AC-43-5` | failure | 5xx | save | `STACK_UPSTREAM_FAILED` | yes |
| `SCN-43-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
