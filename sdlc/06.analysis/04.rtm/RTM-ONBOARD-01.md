---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-39.md"
status: DRAFT
phase: 1
id: RTM-ONBOARD-01
type: traceability-matrix
---

# RTM-ONBOARD-01 — `/onboarding`

| AC | SCN | endpoint | bảng | test |
|---|---|---|---|---|
| `AC-39-1` | `SCN-39-1` | `GET /consumers` | `platform.consumer` | `eso/ui/test/onboarding.test.mjs:16` |
| `AC-39-2` | `SCN-39-2` | `GET /consumers` | — | `:75` |
| `AC-39-3` | `SCN-39-3` | `POST .../provision` | `platform.consumer` | `:111` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **3/3** |
| `AC` có test chạy được | **0/3** — file tồn tại nhưng `node --test` **fail** (`Cannot find module .../client.js`); xem [`12.test-runnability`](../../02.governance/02.records/12.test-runnability.md) |
