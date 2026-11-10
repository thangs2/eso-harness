# Agent harness — eso-harness

Repo này chứa **cấu hình agent dùng chung cho nhiều host** (`agents/`), **luật + artifact** (`sdlc/`), script vận hành
(`scripts/`) và plugin DSH (`tools/`). Nó **không** chứa `packages/`, `docs/`, `profiles/` — xem `D-108` điều 8 trong
[`03.artifact-va-folder`](sdlc/03.inception/02.decision-log/03.artifact-va-folder.md).

## Luật gốc — một nguồn, nhiều cửa

| | |
|---|---|
| **Nguồn duy nhất** | `agents/` — rules · subagents · skills · hooks · instructions (+ README) |
| **Artifact sinh ra** | `.cursor/**` · `.agents/**` · `AGENTS.local.md` |
| **Sinh lại** | `node scripts/build-host-trees.mjs` |
| **Gate** | `node scripts/build-host-trees.mjs --check` · `node scripts/check-dual-harness.mjs` |
| **Quyết định** | `D-108` — [`03.artifact-va-folder.md`](sdlc/03.inception/02.decision-log/03.artifact-va-folder.md) |

**NEVER** sửa tay `.cursor/**`, `.agents/**`, `AGENTS.local.md`: đó là drift và `--check` sẽ đỏ. **NEVER** symlink trong tree
provider (`D-108` điều 3). Sửa `agents/`, chạy generator, chạy hai gate.

## Law gate (forced, mọi host)

```text
host nạp law → agents/rules/core.law-gate.mdc → Read AGENTS.md (file này) → rule khác chỉ bổ sung
```

1. **Đọc `AGENTS.md`** (toàn file) trước khi plan/Write.
2. `AGENTS.md` là **luật cao nhất**: `AGENTS.md` > rule > skill > trí nhớ phiên.
3. Rule/kỹ năng không được trái `AGENTS.md`.

Catalog đường dẫn: [`agents/instructions.md`](agents/instructions.md) — **không phải luật**.

## Host matrix (đo 2026-11-08 — `M` đo, `R` repo tự khẳng định, `U` chưa đo)

| Host | Cửa nhận rule | Skills | Subagents | Hooks | MCP | Law | Trạng thái |
|---|---|---|---|---|---|---|---|
| Cursor | `.cursor/rules/*.mdc` **R** | `.cursor/skills` **R** | `.cursor/agents/*.md` **R** | `.cursor/hooks.json` **R** | `.cursor/mcp.json` **R** | `AGENTS.md` + rules | bật |
| Antigravity | `.agents/rules/*.md` **R** | `.agents/skills` **R** | `.agents/agents/*.md` **R** | path chưa xác định **U** | `.agents/mcp_config.json` **R** | `AGENTS.md` (`user_rules`) | bật |
| DSH | **không đọc rule dir** → `AGENTS.local.md` **M** | `.agents/skills` **M** | không discovery (vai = profile row) **M** | `.claude/hooks.json` qua plugin `dsh-hooks-claude-code` **M** | profile rows **M** | `AGENTS.md` + `AGENTS.local.md` **M** | bật |
| Claude | **U** — `CLAUDE.md` + `@import`; `CLAUDE.md` = `@AGENTS.md` (1 dòng) | **U** `.claude/skills` | **U** `.claude/agents` | **U**: `.claude/settings.json` (native) vs `.claude/hooks.json` (dialect plugin DSH) | **U** | `CLAUDE.md` → `@AGENTS.md` | `mode: off` |
| Codex | — | — | — | — | — | `AGENTS.md` | **defer** (`D-90` §5) |

**Luật suy ra:** *"DSH có X"* là câu vô nghĩa nếu không nói **profile** — capability là **profile-scoped** (`core.paseo-provider`).
Host chưa có trong bảng ⇒ **đo rồi bổ sung**, không giả định. Bật Claude = đổi 1 entry `HOSTS` trong
[`scripts/build-host-trees.mjs`](scripts/build-host-trees.mjs), sau khi đo 4 điểm `U`.

## Thứ tự làm việc & kỷ luật token

1. **AgentMemory first** — `memory_smart_search` đầu turn để lấy context cũ, ticket id, symbol, path (nếu profile mount
   `memory_*`; không có thì **nói rõ**, đừng khai đã tra).
2. **Tra cứu thay vì đoán** — `docgraph --q "<terms>" --repo "$PWD"` cho luật/quyết định; Read thẳng `sdlc/` khi docgraph thiếu.
3. **Codegraph** — `codegraph_explore` (`projectPath` = root repo) hoặc CLI `--path "$PWD"`; chỉ Grep+Read khi thiếu.
4. **Range-read & shell limit** — file > 100 dòng thì đọc theo `sed -n 'X,Yp'`; output thô ≤ 40 dòng, pipe `tail`/`head`.
5. **Implement** — sửa `agents/` (nguồn) → `node scripts/build-host-trees.mjs` → hai gate xanh.
6. **Memory save** — cuối turn quan trọng: `memory_save` cô đọng quyết định/trạng thái/bài học.

## Công cụ

| Nguồn | Khi dùng | Ghi chú |
|---|---|---|
| **Codegraph** | symbol, call path, blast radius trong repo | MCP `codegraph` (`.cursor/mcp.json`) hoặc CLI `codegraph explore "<sym>" --path "$PWD"` |
| **Docgraph** | luật, quyết định, invariant, WBS | CLI `docgraph --q "<terms>" --repo "$PWD"` |
| **AgentMemory** | context phiên, preference operator | `memory_smart_search` / `memory_save` (nếu profile mount) |
| **DeepSeek** | phân tích sâu, debug khó | `ask_deepseek_flash` mặc định, `pro` khi cần |

MCP **không** thuộc generator: `.cursor/mcp.json` (Cursor) và `.agents/mcp_config.json` (Antigravity) là file **máy-local**, gitignored,
mang path tuyệt đối và key. Danh sách server repo này cần nằm ở bảng MCP trong `agents/rules/core.harness-tooling.mdc` — đó là bản ghi
duy nhất trong git.

## SLP — work partitioning when touching >1 layer

| Component | Location |
|---|---|
| Law | [`agents/rules/core.slp.mdc`](agents/rules/core.slp.mdc) |
| Procedure | skill `harness-engineering-team` |
| 7 workers | [`agents/subagents/`](agents/subagents/) — `scout · plan · build · verify · audit · fixbug · qc` |
| Evidence | returned in the worker **response**; temporary copy in `/tmp/slp/` (outside the repo) — **never cite it** |

**Operator shorthand:** `impl <KEY> slp g` = implement the ticket through SLP with guardrails
(scope · status · contract · evidence). The shorthand is defined in `core.slp.mdc` §0/§4.1; do not paste guardrails into prompts.

**Hard order:** build → verify PASS → audit (rubric ≥85, 0 CRITICAL) → `Human In Review`; QC only when the operator asks.
Same root error **3 times** ⇒ stop, escalate **to the human**. **No** agent signs `Done`; **no** commit/push/PR unless the user asks.

## Layout

```text
agents/            nguồn duy nhất: rules · subagents · skills · hooks · instructions.md (+ README)
scripts/           build-host-trees.mjs · check-dual-harness.mjs · jira-*.mjs · dsh/ · …
sdlc/              luật + artifact (không ship, không provision)
tools/dsh-plugins/ plugin DSH (agentmemory, jira)
.cursor/           generated — Cursor tree
.agents/           generated — Antigravity tree + skills mà DSH đọc
AGENTS.md          luật này
AGENTS.local.md    generated — mirror always-on cho DSH
```

## Quy ước

- ESM `.mjs`; repo này **không có** `package.json` hay test runner — verify bằng hai gate script.
- **Không** dùng `comments/` (đã bỏ 2026-11-09). Scratch → `/tmp/`; tài liệu bền → `sdlc/<NN.topic>/`.
- **Không** commit `.harness/`, `.cursor/session/`, `.agents/session/`.
- Chỉ commit khi user yêu cầu.

## Phạm vi

| Việc | Repo |
|---|---|
| Sửa rule/skill/subagent/hook | **eso-harness** (`agents/`) |
| Cấu hình MCP | **máy này** — `.cursor/mcp.json` · `.agents/mcp_config.json` (gitignored, không sinh); danh sách server ở bảng trong `core.harness-tooling` |
| Luật, quyết định, artifact SDLC | **eso-harness** (`sdlc/`) |
| Code sản phẩm v2 (`eso/**`: control-plane · UI · graph · evidence · knowledge · learn · iam · adapters · extractors · cli) | **có** ở repo này; `packages/` v1 · `docs/` · `profiles/` **không** (`D-108` điều 8) |
| Consumer x79 | window khác — `agents/rules/core.workspace-isolation.mdc` |

Khi task mơ hồ "fix harness": mặc định sửa `agents/` trong repo này; nếu nó chạm code sản phẩm thì **nói rõ là ngoài phạm vi**
thay vì tạo folder mới.
