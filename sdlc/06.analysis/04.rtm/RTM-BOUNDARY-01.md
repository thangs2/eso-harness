---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-48.md"
status: DRAFT
phase: 1
id: RTM-BOUNDARY-01
type: traceability-matrix
---

# RTM-BOUNDARY-01 — `settings?tab=boundaries`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-48-1` | `SCN-48-1` · `02` | `GET .../boundaries` | `.harness/policy/*.json` (không phải bảng) | `qc/eso-settings-boundaries-docs.test.mjs` |
| `AC-48-2` | `SCN-48-3` | `PUT .../boundaries` | `.harness/policy/*.json` (không phải bảng) | `qc/eso-settings-boundaries-docs.test.mjs` |
| `AC-48-3` | `SCN-48-4` · `05` | `POST/DELETE .../boundaries/grants` | grant trong policy JSON (TTL server default) | `qc/eso-settings-boundaries-docs.test.mjs` |
| `AC-48-4` | `SCN-48-6` · `07` | `PUT .../boundaries` | — | `qc/eso-settings-boundaries-docs.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **4/4** |
| `AC` có test chạy được | **4/4** doc+code |
| **API test** | **chưa có** — `OPEN-BOUNDARY-API-TEST` |
