---
name: harness-engineering-team
description: Runs one eso-harness ticket through SLP — scout, plan, disjoint slices, build peers, verify, audit rubric (>=85, 0 CRITICAL), QC. Use when a request touches more than one layer of agent config (agents/rules, skills, subagents, hooks, mcp) or more than one script. Lead-facing procedure; the law is core.slp.mdc.
---

# harness-engineering-team

**Bạn là Lead.** Skill này là **thứ tự**; **luật** là `agents/rules/core.slp.mdc` — trên host không nạp rule (DSH) thì các mục
§1–§4 dưới đây là bản tối thiểu bắt buộc.

Worker: `agents/subagents/*-runtime.md` (**7**) — mỗi host nhận bản generated ở `<tree>/agents/`. Blackboard DAG: worker chỉ nói
với Lead (Antigravity: `invoke_subagent`).

## 0. Dùng khi

Task cần >1 file hoặc >1 tầng cấu hình agent (`agents/rules` · `skills` · `subagents` · `hooks` · `mcp`) hoặc sửa cả
`scripts/`. **Không** dùng cho câu hỏi, typo, sửa một dòng (nhưng vẫn phải verify + audit).

## 1. Bốn lớp

**S** = người (duyệt plan · xử escalation · ký `Done`) · **L** = bạn · **P** = `scout` `plan` `build` `fixbug` · **A** = `verify`
`audit` `qc`. S **không bao giờ** là agent; gate **không** sửa `agents/` · `scripts/` · `tools/`.

## 2. Hợp đồng prompt — luôn 4 phần

`INV ids` · `AC rows in scope` · `allowed_files` · `verify command`. Thiếu ⇒ worker hỏi lại, **không đoán**.

## 3. Trả về — mỗi worker một JSON có kiểu

| Worker | Trả về |
|---|---|
| `scout` | `domains[]` `inv[]` `touched_files[]` `open_gaps[]` `risks[]` (≤300 từ) |
| `plan` | `slices[]`: `id` `role` `ac[]` `inv[]` `allowed_files[]` `depends_on[]` `verify` |
| `build` | `status` `DONE\|BLOCKED_SCOPE` · `files_changed[]` `tests_added[]` |
| `verify` | `status` PASS/FAIL · `commands_run[]` · `failure_log` |
| `audit` | `verdict` · `score` · `critical[]` · `findings[{file,line,rule,fix}]` · `ac_coverage{}` |
| `qc` | `status` · `failed_gates[]` · `scenarios_run[]` · `residual_open[]` |

JSON có kiểu là mấu chốt: bạn **ghép** được mà không đọc văn xuôi, và `findings[].file:line` cho `fixbug` việc **không cần hỏi lại**.

## 4. Luật cứng

1. Slice `allowed_files` **rời nhau** — chồng = plan không hợp lệ, chia lại.
2. Ghi ngoài slice ⇒ `BLOCKED_SCOPE`, dừng.
3. Zero-crawl: peer nhận pack trong prompt, không đọc `sdlc/01…09`.
4. Cùng lỗi gốc **3** lần ⇒ dừng, liệt kê `OPEN`, escalate **lên người**.
5. Không `Done`, không commit/push/PR trừ khi S yêu cầu.
6. Codegraph/docgraph thiếu ⇒ nói ra + fallback; **không** claim success.
7. `.cursor/**`, `.agents/**`, `AGENTS.local.md` là **artifact sinh ra** — không worker nào ghi vào đó; Lead chạy generator.

## 5. Thứ tự gate — đánh số, không nhảy

1. **Classify** — `agent-config` (`agents/*`, `scripts/*`) · `law/spec` (`sdlc/`) · `ticket`. Prompt lẫn lộn ⇒ **hỏi hoặc
   REWORK**, không đoán AC.
2. **Pack** — ticket + `sdlc/01.agent-manifests/` + AC + **một** verify command. Chưa đủ ⇒ spawn `scout` **trước**; chưa có pack
   thì **không** spawn `build`.
3. **Session** — `AGENTS.md` đã Read; MCP/brain theo `core.harness-tooling.mdc`. Thiếu công cụ ⇒ ghi rõ, không giả định.
4. **Plan** — spawn `plan`. **S-GATE 1** khi >1 tầng hoặc scope mơ hồ: đưa bảng slice cho S duyệt.
5. **Build × N** — spawn một `build` mỗi slice; song song khi `depends_on` rỗng.
6. **Regenerate** — **Lead** chạy `node scripts/build-host-trees.mjs` (worker bị cấm ghi tree).
7. **Verify** — spawn `verify` với **đúng** lệnh của Task: `node scripts/build-host-trees.mjs --check` và
   `node scripts/check-dual-harness.mjs`. FAIL ⇒ sang 8.
8. **Audit** — spawn `audit` trên diff. `AUDIT_FAIL` ⇒ `fixbug` ↺ về 6. **3** vòng ⇒ **S-GATE 2**.
9. **Human In Review** — Lead ghi comment + nhãn + rollup. **Không** `Done`: quyền đó của S.
10. **QC** — khi operator yêu cầu: spawn `qc` (scenario → trả trong response; log tạm `/tmp/slp/qc/`). **S-GATE 3**: S ký `Done`.

## 6. Rubric `audit` (tóm tắt — chi tiết trong rule §6)

`30` deterministic green (hai gate script xanh **trong phiên này**) · `30` bất biến (không tạo **nguồn sự thật thứ hai**: chỉ sửa
`agents/`, không sửa tree provider; `D-108` điều 1–7) · `25` AC đủ + không hợp đồng tự chế · `15` kỷ luật biên. **CRITICAL**
(INV · nguồn sự thật thứ hai · hợp đồng tự chế · fake green) ⇒ FAIL bất kể điểm.

## 7. Chọn slice (mặc định, theo tầng cấu hình)

`rules` (`agents/rules/`) → `skills` (`agents/skills/`) → `subagents` (`agents/subagents/`) → `hooks` (`agents/hooks/`) →
`scripts` (`scripts/*.mjs`) · `law/sdlc` (**Lead/người**, không giao peer).

Slice chỉ **đọc** (scout/verify/audit) được chia theo cùng trục nhưng không giữ vùng ghi.

## 8. Bằng chứng cuối lượt

`class` · pack đã đọc · codegraph/docgraph status · lệnh verify + log · `audit` score/verdict · slice + file đã ghi ·
`memory_save` nếu có quyết định. Thiếu ⇒ **không** nói "đã xong".

## 9. Một lượt, viết gọn

```text
Lead: pack ESO-… → plan → S1(agents/rules) ∥ S2(agents/skills) → regenerate → verify(PASS) → audit(91, 0 CRITICAL) → HIR
      nếu audit fail: fixbug(findings) → regenerate → verify ↺ (loop 2/3)
```

## Jira — chuẩn ticket & rollup

Ticket sinh từ **packet + AC**. Hierarchy: `Epic → (Story|Task|Bug) → Subtask`. **Story** chỉ khi map 1:1 `US-nn` + AC người dùng thấy; work package kỹ thuật/enabler = **Task**; không tạo Story và Task cho cùng việc.
Mỗi ticket phải đủ 4 quan hệ: `subtask` · `relates` · `blocks` · `is blocked by` (ngoại lệ root phải có `why`).
Điểm: **Fibonacci 1/2/3/5/8/13 chỉ trên Subtask**; parent = Σ subtask, Epic = Σ task; `jira-points-rollup.mjs` kiểm.
Status rollup: chạy `jira-rollup.mjs` sau **mỗi** child transition; agent không ký `Done`.
**Ngôn ngữ:** mọi nội dung ticket Jira (summary/description/comment/label/attachment) = **English**; docs ngoài Jira vẫn có thể tiếng Việt.
Chi tiết: rule `delivery.jira-agent-execution`.

