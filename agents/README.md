# `agents/` — nguồn duy nhất của cấu hình agent

**Sửa ở đây.** `.cursor/**`, `.agents/**` và `AGENTS.local.md` là **artifact sinh ra** (`D-108`); sửa tay ở đó là drift và
`--check` sẽ đỏ.

## Cây

```text
agents/
├── rules/            *.mdc — luật; frontmatter `description` + `alwaysApply` (+ `globs` khi theo path)
├── subagents/        *-runtime.md — 7 worker SLP + README
├── skills/           <name>/SKILL.md — + SOT-MAP.md (catalog)
├── hooks/            *.mjs (code) + hooks.map.json (host nào đăng ký hook nào)
└── instructions.md   catalog chain, 1 bản
```

## Việc thường làm

| Muốn | Làm | Sau đó |
|---|---|---|
| Sửa rule | sửa `agents/rules/core.x.mdc` | `node scripts/build-host-trees.mjs` |
| Thêm rule | thêm `.mdc` có `description`; `alwaysApply: true` nếu phải áp mọi phiên | generator sinh `.cursor/rules/*.mdc` + `.agents/rules/*.md` + mirror DSH |
| Thêm skill | `agents/skills/<name>/SKILL.md` có frontmatter `name` + `description` | generator sinh 2 tree |
| Thêm MCP server | sửa `.cursor/mcp.json` / `.agents/mcp_config.json` **trên máy** (gitignored, không sinh); ghi vào bảng MCP của `agents/rules/core.harness-tooling.mdc` | không cần generator |
| Thêm hook | `agents/hooks/*.mjs` + entry trong `agents/hooks/hooks.map.json` | generator sinh tree hooks + `hooks.json` |
| Thêm host | **1 entry** trong `HOSTS` của `scripts/build-host-trees.mjs` (`mode: off` nếu chưa đo) | `check-dual-harness.mjs` tự áp hợp đồng extension cho host đó |

## Bất biến

1. `.cursor/rules` chỉ `.mdc`; `.agents/rules` và `.claude/rules` chỉ `.md`.
2. **Không symlink**, mọi dạng — git trên Windows checkout symlink thành file text và host nạp rỗng, im lặng.
3. `AGENTS.local.md` là cửa **duy nhất** của rule tới DSH.
4. `agents/` không dot-prefix, không trùng tên host ⇒ không host nào tự nạp nó.

## Verify

```bash
node scripts/build-host-trees.mjs --check
node scripts/check-dual-harness.mjs
```
