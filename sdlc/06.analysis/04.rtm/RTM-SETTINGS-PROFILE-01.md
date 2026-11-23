---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-06.md"
status: DRAFT
phase: 1
id: RTM-SETTINGS-PROFILE-01
type: traceability-matrix
---

# RTM-SETTINGS-PROFILE-01 — `settings?tab=profile`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-06-1` | `SCN-06-1` | `PUT /consumers/{id}` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-06-2` | `SCN-06-2` | `PUT /consumers/{id}` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-06-3` | `SCN-06-3` | `PUT /consumers/{id}` | `platform.consumer` | `eso/control-plane/test/registry.test.ts` |
| `AC-06-4` | `SCN-06-4` | `PUT /consumers/{id}` | `platform.consumer` | `qc/eso-settings-profile-docs.test.mjs` |
| `AC-06-5` | `SCN-06-5` | `PUT /consumers/{id}` | `platform.consumer` | `qc/eso-settings-profile-docs.test.mjs` |
| `AC-06-6` | `SCN-06-6` · `07` | nhiều | — | `qc/eso-settings-profile-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **6/6** |
| `AC` có test chạy được | **6/6** (3 API · 3 doc+code) |
| **Trạng thái UI** | ✅ cấu trúc chốt (`44374c8`) |
| **Mã lỗi UI** | ✅ 5 mã `PROFILE_*` (SRS `04` §6) |
