---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-01.md"
status: DRAFT
phase: 1
id: RTM-LOGIN-01
type: traceability-matrix
---

# RTM-LOGIN-01 — `/login`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-01-1` | `SCN-01-1` | `GET /auth/me` | — | `eso/control-plane/test/auth.test.ts` (API only) |
| `AC-01-2` | `SCN-01-2` | — | — | `qc/eso-auth.test.mjs` (source-invariant, API auth) |
| `AC-01-3` | `SCN-01-3` | — | — | `qc/eso-auth.test.mjs` (source-invariant, API auth) |
| `AC-01-4` | `SCN-01-4` | — | — | `qc/eso-auth.test.mjs` (source-invariant, API auth) |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **4/4** |
| `AC` có test chạy được | **4/4** — `qc/eso-auth.test.mjs` (API semantics); bề mặt UI vẫn chưa có test riêng (`OPEN-LOGIN-UI-TEST`) |
