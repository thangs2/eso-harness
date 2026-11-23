---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-44.md"
status: DRAFT
phase: 1
id: SCN-44
type: scenario-matrix
---

# SCN-44 — kịch bản `AC-44`

**AC:** [`AC-44`](../02.ac/AC-44.md)
> Cardinality: **1 `AC` → n `SCN`**.

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-44-1` | `AC-44-1` | edge | 0 binding | mở tab | empty state | yes |
| `SCN-44-2` | `AC-44-1` | happy | 2 binding | mở tab | bảng developer×host×version | yes |
| `SCN-44-3` | `AC-44-2` | happy | v3 published | new binding + Save | 1 dòng host_binding | yes |
| `SCN-44-4` | `AC-44-3` | edge | 3 dev ở v1, v2 published | bulk upgrade v2 | 3 con trỏ đổi | yes |
| `SCN-44-5` | `AC-44-4` | edge | flow v1 published, v2 draft | pin flow | chỉ v1 | yes |
| `SCN-44-6` | `AC-44-5` | failure | version draft | Save binding | `VERSION_NOT_PUBLISHED` | yes |
| `SCN-44-7` | `AC-44-5` | failure | version không tồn tại | Save binding | `VERSION_NOT_FOUND` | yes |
| `SCN-44-8` | `AC-44-5` | rbac | 401/403 | Save binding | `BINDING_DENIED` | yes |
| `SCN-44-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
