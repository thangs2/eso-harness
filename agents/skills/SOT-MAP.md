# Skills — eso-harness

**Skills sống ở `agents/skills/`** — nguồn duy nhất. `.cursor/skills/` và `.agents/skills/` là **bản sinh ra** bằng
`node scripts/build-host-trees.mjs`; không sửa tay. DSH đọc skill từ `.agents/skills/*/SKILL.md` (đo 2026-11-08).

Procedures live here; **law** lives in `AGENTS.md` + `agents/rules/`.

| Skill | When | SoT |
|-------|------|-----|
| `harness-engineering-team` | Task chạm **>1 tầng** — SLP: scout → plan → build×N → verify → audit → qc | `agents/rules/core.slp.mdc` · `agents/subagents/*-runtime.md` |
| `paseo-recon` | Session do Paseo spawn (`PASEO_AGENT_ID`): profile mount gì, codegraph/docgraph CLI per-cwd, thêm MCP vào profile | `agents/rules/core.paseo-provider.mdc` |

**Đã bỏ 2026-11-08** (`D-108` điều 8): `harness-eso-implement` · `harness-verify` · `nestjs-standard` · `angular-standard` — chúng
thao tác trên `packages/`, `eso/control-plane`, `eso/ui`, những folder **không còn** trong repo này. Không copy chúng từ repo khác
vào đây; mở window của repo tương ứng.

MCP wiring: `agents/rules/core.harness-tooling.mdc`.
