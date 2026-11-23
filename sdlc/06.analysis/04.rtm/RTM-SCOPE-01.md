---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-50.md"
status: DRAFT
phase: 1
id: RTM-SCOPE-01
type: traceability-matrix
---

# RTM-SCOPE-01 — scope guard

| AC | SCN | endpoint | hàm | test |
|---|---|---|---|---|
| `AC-50-1` | `SCN-50-1` · `02` | — | `checkFileWriteScope` / `executeFileWrite` | `eso/control-plane/test/scope.test.ts` |
| `AC-50-2` | `SCN-50-3` | — | `executeFileWrite` | `eso/control-plane/test/scope.test.ts` |
| `AC-50-3` | `SCN-50-4` | — | `checkFileWriteScope` | `eso/control-plane/test/scope.test.ts` |
| `AC-50-4` | `SCN-50-5` | — | `checkFileWriteScope` (dirExists) | `eso/control-plane/test/scope.test.ts` |
| `AC-50-5` | `SCN-50-6` · `07` | — | `transitionTaskStatus` | `eso/control-plane/test/scope.test.ts` |
| `AC-52-1` | `SCN-52-1` | — | `queryTaskJudgement` | `eso/control-plane/test/scope.test.ts` |
| `AC-52-2` | `SCN-52-2` | — | `queryTaskJudgement` (message identity) | `eso/control-plane/test/scope.test.ts` |
| `AC-52-3` | `SCN-52-3` · `04` | — | `queryTaskJudgement` | `eso/control-plane/test/scope.test.ts` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **8/8** |
| `AC` có test chạy được | **8/8** |
