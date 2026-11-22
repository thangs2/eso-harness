---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-42.md"
status: DRAFT
phase: 1
id: SCN-42
type: scenario-matrix
---

# SCN-42 — kịch bản page `/consumers/:id/flows`

**AC:** [`AC-42`](../02.ac/AC-42.md) · **RTM:** [`RTM-FLOW-01`](../04.rtm/RTM-FLOW-01.md)
> **Nhà:** kịch bản. Cardinality: **1 `AC` → n `SCN`**.

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-42-1` | `AC-42-1` | happy | 2 flow | mở trang | list 2 dòng | yes |
| `SCN-42-2` | `AC-42-1` | edge | 0 flow | mở trang | `No flow yet.` | yes |
| `SCN-42-3` | `AC-42-2` | happy | flow draft + default | chọn lần lượt | badge đúng | yes |
| `SCN-42-4` | `AC-42-3` | happy | có worker set | `+ New flow` | draft mới | yes |
| `SCN-42-5` | `AC-42-3` | failure | worker set rỗng | `+ New flow` | `FLOW_WORKERS_REQUIRED` | yes |
| `SCN-42-6` | `AC-42-4` | happy | flow mở | Rename + Enter | tên mới lưu | yes |
| `SCN-42-7` | `AC-42-4` | edge | flow mở | Rename + rỗng + Enter | huỷ, tên cũ | yes |
| `SCN-42-8` | `AC-42-5` | happy | draft | kéo node, nối cạnh có `on`, sửa guard | state đổi, có history | manual |
| `SCN-42-9` | `AC-42-6` | happy | có history | Undo → Redo → Fit/Snap/Auto | đúng thứ tự, không gọi API | manual |
| `SCN-42-10` | `AC-42-7` | happy | flow hợp lệ | Validate | `ok` | yes |
| `SCN-42-11` | `AC-42-7` | edge | flow có loop | Validate | warning `FLOW_HAS_LOOP` | yes |
| `SCN-42-12` | `AC-42-7` | failure | edge trỏ worker lạ | Validate | invalid + lỗi nêu | yes |
| `SCN-42-13` | `AC-42-8` | happy | draft hợp lệ | Publish | published `v<n>`, draft mất | yes |
| `SCN-42-14` | `AC-42-9` | edge | draft + published | Set default trên draft | nút disabled | yes |
| `SCN-42-15` | `AC-42-9` | happy | published | Set default | badge chuyển | yes |
| `SCN-42-16` | `AC-42-10` | edge | draft + published | Delete draft + xác nhận | chỉ draft mất | yes |
| `SCN-42-17` | `AC-42-11` | rbac | 401/403 | mở trang | `FLOW_DENIED` | yes |
| `SCN-42-18` | `AC-42-11` | failure | 404 | chọn flow | `FLOW_NOT_FOUND` | yes |
| `SCN-42-19` | `AC-42-11` | failure | 5xx | save/publish | `FLOW_UPSTREAM_FAILED` | yes |
| `SCN-42-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
