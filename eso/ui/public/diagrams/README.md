# Diagram assets

UI copies of the SDLC diagrams. The Mermaid source in `sdlc/` is authoritative for the pipeline copies.

- `01.main-pipeline.png` ← `sdlc/02.governance/04.diagrams/01.main-pipeline.png`
- `02.cr-pipeline.png` ← `sdlc/02.governance/04.diagrams/02.cr-pipeline.png`
- `03.intent-pipeline.png` ← `sdlc/02.governance/04.diagrams/03.intent-pipeline.png`

Refresh the generated copies after regenerating the Mermaid source:

```bash
cp sdlc/02.governance/04.diagrams/01.main-pipeline.png eso/ui/public/diagrams/
cp sdlc/02.governance/04.diagrams/02.cr-pipeline.png eso/ui/public/diagrams/
cp sdlc/02.governance/04.diagrams/03.intent-pipeline.png eso/ui/public/diagrams/
```

- `that-tinh-tran-diagram.svg` — original Seven-Star Formation drawing supplied by the operator
  (2026-11-12; a PDF export exists alongside the source). Do not regenerate; the SVG is the source.
