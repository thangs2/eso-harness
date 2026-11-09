# Agent instructions index (not law)

**Do not treat this file as law.** Law is `AGENTS.md` at the repo root. This file says where things live and which door each
host actually reads.

## Một nguồn, nhiều cửa

```text
agents/                                  ← NGUỒN DUY NHẤT — sửa ở đây
  rules/  skills/  subagents/  hooks/  mcp/  instructions.md
        │
        │  node scripts/build-host-trees.mjs
        ├── .cursor/…          generated: rules/*.mdc · agents/*.md · skills/ · hooks.json
        ├── .agents/…          generated: rules/*.md  · agents/*.md · skills/
        └── AGENTS.local.md    generated: mirror always-on cho DSH
```

Tree provider là **artifact**. Sửa tay ở đó = drift, và `node scripts/build-host-trees.mjs --check` sẽ đỏ.

## Forced chain (mọi host)

```text
host → law gate (agents/rules/core.law-gate.mdc) → Read AGENTS.md → rules → skills → subagents
```

| Host | Cửa nhận rule | Ghi chú |
|------|----------------|---------|
| Cursor | `.cursor/rules/*.mdc` | `alwaysApply` áp luôn; `globs` theo file chạm |
| Antigravity | `.agents/rules/*.md` | `AGENTS.md` vào `user_rules` |
| DSH | `AGENTS.local.md` | **không** đọc rule dir; skills đọc từ `.agents/skills` |
| Claude | `CLAUDE.md` = `@AGENTS.md`; `.claude/` đang `mode: off` | 4 discovery path **chưa đo** — bật khi đã đo (`D-108`) |
| Codex | `AGENTS.md` | không tree, không adapter (`D-90` §5) |

## Catalogs

| Concern | Path |
|---------|------|
| Law | **`AGENTS.md`** (root) |
| Gate rule | `agents/rules/core.law-gate.mdc` |
| Rules (nguồn) | `agents/rules/` — 10 rule, xem bảng dưới |
| Skills | `agents/skills/SOT-MAP.md` |
| Subagents | `agents/subagents/README.md` |
| Hooks | `agents/hooks/` + `agents/hooks/hooks.map.json` |
| MCP | `.cursor/mcp.json` · `.agents/mcp_config.json` — **máy-local**, gitignored, không sinh; danh sách server ở `agents/rules/core.harness-tooling.mdc` |
| Layout decision | `D-108` — `sdlc/03.inception/02-decision-log/03.artifact-va-folder.md` |

## Rules

| Rule | `alwaysApply` | `globs` |
|------|---------------|---------|
| `core.law-gate` | ✅ | — |
| `core.workspace-isolation` | ✅ | — |
| `core.artifacts` | ✅ | — |
| `core.conversation-hygiene` | ✅ | — |
| `core.harness-agents` | ✅ | — |
| `delivery.jira-agent-execution` | — | `sdlc/09.wbs/**/*,scripts/jira-*` |
| `core.slp` | — | `agents/**,scripts/**,tools/**,sdlc/01.agent-manifests/**` |
| `core.harness-tooling` | — | `.cursor/mcp.json,scripts/**` |
| `core.paseo-provider` | ✅ | — |
| `core.reply-format` | ✅ | — |

## Skills

`harness-engineering-team` · `paseo-recon` — chi tiết ở `agents/skills/SOT-MAP.md`.
