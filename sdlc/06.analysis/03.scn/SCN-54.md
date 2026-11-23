---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-54.md"
status: DRAFT
phase: 1
id: SCN-54
type: scenario-matrix
---

# SCN-54 — kịch bản `AC-54`

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-54-1` | `AC-54-1` | happy | chưa có host | register | host + runtime + notice | yes |
| `SCN-54-2` | `AC-54-2` | failure | Host ID sai slug | submit | message slug; không API | yes |
| `SCN-54-3` | `AC-54-2` | failure | Host ID trùng | register | `already exists` | yes |
| `SCN-54-4` | `AC-54-3` | edge | host có | edit label | lưu; ID read-only | yes |
| `SCN-54-5` | `AC-54-4` | happy | runtime unknown | heartbeat | health đổi + notice | yes |
| `SCN-54-6` | `AC-54-5` | edge | 0 model | mở sheet | empty + reported-by-host | yes |
| `SCN-54-7` | `AC-54-6` | failure | heartbeat rỗng | heartbeat | `missing for <key>` | yes |
| `SCN-54-TENANT-OUT` | — | tenant | — | — | `OUT` | — |
