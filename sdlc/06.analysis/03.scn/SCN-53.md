---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-53.md"
status: DRAFT
phase: 1
id: SCN-53
type: scenario-matrix
---

# SCN-53 — kịch bản `AC-53`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-53-1` | `AC-53-1` | happy | 20 event | mở `/events?consumer=A` | list 20 | no |
| `SCN-53-2` | `AC-53-1` | edge | 0 event | mở | `No matching events` + gợi ý | no |
| `SCN-53-3` | `AC-53-2` | happy | nhiều event | lọc event/outcome | đúng tập | no |
| `SCN-53-4` | `AC-53-2` | edge | trace id đầy đủ / một phần | nhập trace | list khớp **substring**; timeline **exact** | no |
| `SCN-53-5` | `AC-53-2` | edge | chip `Failures` đang bật | bấm `All` | event filter reset, **outcome vẫn FAIL** | no |
| `SCN-53-6` | `AC-53-3` | happy | event `prompt.submitted` | chọn | detail + link request + card 5 field | no |
| `SCN-53-7` | `AC-53-3` | edge | event khác | chọn | detail không có request card | no |
| `SCN-53-8` | `AC-53-4` | failure | API lỗi | mở | banner message, không mã | no |
| `SCN-53-9` | `AC-53-5` | edge | SSE không mở | mở | `poll fallback` + poll 5 s | no |
| `SCN-53-10` | `AC-53-6` | edge | 90 event | `Next` | 40 dòng, `Page 2 / 3` | no |
| `SCN-53-TENANT-OUT` | — | tenant | — | — | `OUT` — chưa multi-tenant | — |
