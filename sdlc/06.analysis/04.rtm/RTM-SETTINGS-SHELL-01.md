---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/03.scn/SCN-55.md"
status: DRAFT
phase: 1
id: RTM-SETTINGS-SHELL-01
type: traceability-matrix
---

# RTM-SETTINGS-SHELL-01 — shell `settings`

| AC | SCN | endpoint | tầng | test |
|---|---|---|---|---|
| `AC-55-1` | `SCN-55-1` | `GET /consumers/{id}` | UI | `qc/eso-settings-shell.test.mjs` |
| `AC-55-2` | `SCN-55-2` · `03` | — | UI (dirty) | `qc/eso-settings-shell.test.mjs` |
| `AC-55-3` | `SCN-55-4` | — | UI (validate workers) | `qc/eso-settings-shell.test.mjs` |
| `AC-55-4` | `SCN-55-5` | migration preview | UI | `qc/eso-settings-shell.test.mjs` |
| `AC-55-5` | `SCN-55-6` | legacy archive | UI | `qc/eso-settings-shell.test.mjs` |

## Coverage

| | |
|---|---|
| `AC` có ≥1 `SCN` | **5/5** |
| `AC` có test chạy được | **5/5** — source-invariant |
