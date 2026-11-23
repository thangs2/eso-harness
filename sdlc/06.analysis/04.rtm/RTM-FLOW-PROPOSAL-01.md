---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-56.md"
status: DRAFT
phase: 1
id: RTM-FLOW-PROPOSAL-01
type: traceability-matrix
---

# RTM-FLOW-PROPOSAL-01 — `F-41`

| AC | SCN | endpoint/service | test |
|---|---|---|---|
| `AC-56-1` | `SCN-56-1` | `flow-proposal.service.readProposal` | `qc/eso-flow-proposal.test.mjs` |
| `AC-56-2` | `SCN-56-2` | cùng service (regex block) | cùng file |
| `AC-56-3` | `SCN-56-3` | `applyProposal` (draft only) | cùng file |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **3/3** |
| `AC` có test chạy được | **3/3** |
