# SLP subagents — eso-harness (Cursor / Antigravity / DSH)

**Model:** Supervisor – Lead – Peer (+ Gate), Blackboard DAG, no unconstrained group chat.
**Law:** `agents/rules/core.slp.mdc` — nguồn duy nhất; `.cursor/rules/*.mdc` · `.agents/rules/*.md` là **artifact sinh ra**
(`node scripts/build-host-trees.mjs`). **Procedure:** skill `harness-engineering-team`.

| Layer | Who | Notes |
|---|---|---|
| **S — Supervisor** | **người** (operator), ngoài vòng lặp | 3 gates: duyệt plan · xử escalation · **ký `Done`**. Không bao giờ là agent. |
| **L — Lead** | agent chat chính | đọc pack, chia slice, spawn worker, ghi `Human In Review` + rollup |
| **P — Peers** | `scout` · `plan` · `build` (mỗi slice) · `fixbug` | `allowed_files` rời nhau; không crosstalk |
| **A — Gates** | `verify` (deterministic) · `audit` (rubric ≥85) · `qc` (scenario) | độc lập với người viết |

## 7 worker

| File | Role | Khi nào | Ghi vào |
|---|---|---|---|
| `scout-runtime.md` | recon, pack ≤300 từ | ticket thiếu AC / blast radius chưa biết | `/tmp/slp/recon/` |
| `plan-runtime.md` | chia slice rời nhau | task >1 tầng | `/tmp/slp/plan/` |
| `build-runtime.md` | peer theo slice | mỗi slice, song song khi `depends_on` rỗng | `agents/` (**nguồn** — không `.cursor/**`/`.agents/**`) · `scripts/` · `tools/` |
| `verify-runtime.md` | build/test thật | sau mỗi lượt build/fix | `/tmp/slp/verify/` |
| `audit-runtime.md` | diff vs INV/AC/biên, 0–100 | sau verify PASS | `/tmp/slp/audit/` |
| `fixbug-runtime.md` | sửa tối thiểu | verify FAIL hoặc audit findings | **dẫn xuất** — `findings[].file` |
| `qc-runtime.md` | scenario matrix | khi operator yêu cầu | `/tmp/slp/qc/` |

Nguồn duy nhất của 7 worker là `agents/subagents/`. Cursor/Antigravity nhận bản **sinh ra** ở `.cursor/agents/*.md` ·
`.agents/agents/*.md` — **không sửa tay**; lệch bị `node scripts/build-host-trees.mjs --check` chặn.

`allowed_files` của 7 worker **rời nhau từng cặp** — Lead so **từng cặp** trước khi giao slice, `audit` kiểm lại trong
`findings[]`. Repo này **không có** test runner để giữ luật đó bằng máy (`qc/` đã bỏ — `D-108` điều 8), nên không tồn tại
`qc/slp-conformance.test.mjs`; disjointness kiểm bằng review + audit. `fixbug` không có tập tĩnh: quyền ghi **dẫn xuất** từ
bằng chứng, nằm trong slice đang FAIL.

## Flow

```text
Lead → (scout) → plan → build×N → verify → audit → (fixbug ↺, max 3) → Lead: HIR + rollup → qc → S ký Done
```

## Verify (repo này **không có** `package.json`)

`node scripts/build-host-trees.mjs` (regenerate — Lead) → `node scripts/build-host-trees.mjs --check` ·
`node scripts/check-dual-harness.mjs`.

## Cấm (mọi worker)

`Done`/`In Progress` hộ ticket · commit/push/PR khi chưa được yêu cầu · ghi ngoài `allowed_files` · sửa `.cursor/**` /
`.agents/**` (artifact sinh ra) · tự chấm điểm · gọi worker khác (chỉ nói với Lead).

**Host không nạp rules (DSH):** skill `harness-engineering-team` **tự chứa** thứ tự gate và luật tối thiểu, nên dùng nó làm
entrypoint; rule chỉ để Cursor nạp tự động.
