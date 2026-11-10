---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-38.md"
status: DRAFT
phase: 1
id: SCN-38
type: scenario-matrix
---

# SCN-38 — Scenario matrix cho `AC-38` (Host capability probe)

**US:** [`US-38`](../01.us/US-38.md) · **AC:** [`AC-38`](../02.ac/AC-38.md) · **Trạng thái:** toàn bộ `planned` — chạy **sau** impl.

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-38-1` | `AC-38-1` | happy | host reachable, probe cài được | chạy probe 6 chiều | card có host version/levels/evidence | yes | `planned` |
| `SCN-38-2` | `AC-38-2` | edge | host thiếu memory dài hạn | probe memory | `unknown`/L2; không claim L4 | yes | `planned` |
| `SCN-38-3` | `AC-38-3` | failure | probe bị policy chặn | chạy probe | `PROBE_BLOCKED`/unknown; không publish level | yes | `planned` |
| `SCN-38-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — probe do operator chạy, chưa có role |
| `SCN-38-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — host không phải tenant |

## Luật

- `SCN` **1:1** với `AC`.
- Viết trước code, **chạy sau** `tdd-impl`; packet `READY` chỉ cần SCN đã khai (`D-81`).
- `OUT` phải có lý do.
