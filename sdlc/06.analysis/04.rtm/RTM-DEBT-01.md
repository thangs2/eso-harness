---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-51.md"
status: DRAFT
phase: 1
id: RTM-DEBT-01
type: traceability-matrix
---

# RTM-DEBT-01 — debt / risk acceptance

| AC | SCN | endpoint | hàm | test |
|---|---|---|---|---|
| `AC-51-1` | `SCN-51-1` | — | `acceptRisk` | `eso/control-plane/test/debt.test.ts` |
| `AC-51-2` | `SCN-51-2` · `03` | — | `acceptRisk` | `eso/control-plane/test/debt.test.ts` |
| `AC-51-3` | `SCN-51-4` | — | `acceptRisk` (RBAC) | `eso/control-plane/test/debt.test.ts` |
| `AC-51-4` | `SCN-51-5` | — | `acceptRisk` | `eso/control-plane/test/debt.test.ts` |
| `AC-51-5` | `SCN-51-6` · `07` | — | `inspectRiskStatus` | `eso/control-plane/test/debt.test.ts` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **5/5** |
| `AC` có test chạy được | **5/5** |
