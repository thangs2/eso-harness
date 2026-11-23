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
| `AC-01-2` | `SCN-01-2` | — | — | **MISSING** (UI) |
| `AC-01-3` | `SCN-01-3` | — | — | **MISSING** (UI) |
| `AC-01-4` | `SCN-01-4` | — | — | **MISSING** (UI) |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **4/4** |
| `AC` có test chạy được | **1/4** — test hiện có chỉ chạm `AuthService`, không chạm `login.page.ts`; `OPEN-LOGIN-UI-TEST` |
