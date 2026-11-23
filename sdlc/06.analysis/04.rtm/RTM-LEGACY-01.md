---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/"
status: DRAFT
phase: 1
id: RTM-LEGACY-01
type: traceability-matrix
---

# RTM-LEGACY-01 — backlog AC chưa có RTM (đo 2026-11-23)

> **Đây là nợ, không phải hoàn thành.** 112 `AC` legacy chưa từng có dòng RTM (batch 1: 7 AC đã đóng 2026-11-23). File này ghi nhận trung thực:
> `SCN` map được (nếu có) · endpoint **chưa xác định** (`—`) · test **MISSING** nghĩa là chưa có test chạy được.
> Mục tiêu: mỗi dòng được thay bằng RTM thật của năng lực tương ứng khi làm tới.

| AC | SCN | endpoint | test |
|---|---|---|---|
| `AC-01-1` | `SCN-01-1` | — | `eso/control-plane/test/auth.test.ts` |
| `AC-01-2` | `SCN-01-2` | — | `qc/eso-auth.test.mjs` ||
| `AC-01-3` | `SCN-01-3` | — | `qc/eso-auth.test.mjs` ||
| `AC-01-4` | `SCN-01-4` | — | `qc/eso-auth.test.mjs` ||
| `AC-03-1` | `SCN-03-1` | — | `eso/control-plane/test/consumer.test.ts` |
| `AC-03-2` | `SCN-03-2` | — | `eso/control-plane/test/consumer.test.ts` |
| `AC-03-3` | `SCN-03-3` | — | `eso/control-plane/test/ac-legacy-batch1.test.ts` |
| `AC-07-1` | `SCN-07-1` | — | `eso/control-plane/test/lifecycle.test.ts` |
| `AC-07-2` | `SCN-07-2` | — | `eso/control-plane/test/ac-legacy-batch1.test.ts` |
| `AC-07-3` | `SCN-07-3` | — | `eso/control-plane/test/ac-legacy-batch1.test.ts` |
| `AC-08-1` | `SCN-08-1` | — | `eso/control-plane/test/lifecycle.test.ts` |
| `AC-08-2` | `SCN-08-2` | — | `eso/control-plane/test/ac-legacy-batch1.test.ts` |
| `AC-08-3` | `SCN-08-3` | — | `eso/control-plane/test/ac-legacy-batch1.test.ts` |
| `AC-09-1` | `SCN-09-1` | — | `eso/control-plane/test/lifecycle.test.ts` |
| `AC-09-2` | `SCN-09-2` | — | `eso/control-plane/test/purge.test.ts` |
| `AC-09-3` | `SCN-09-3` | — | `eso/control-plane/test/purge.test.ts` |
| `AC-10-1` | `SCN-10-1` | — | `eso/control-plane/test/profile.test.ts` |
| `AC-10-2` | `SCN-10-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-10-3` | `SCN-10-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-11-1` | `SCN-11-1` | — | `eso/control-plane/test/profile.test.ts` |
| `AC-11-2` | `SCN-11-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-11-3` | `SCN-11-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-12-1` | `SCN-12-1` | — | `eso/control-plane/test/isolation.test.ts` |
| `AC-12-2` | `SCN-12-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-12-3` | `SCN-12-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-13-1` | `SCN-13-1` | — | `eso/control-plane/test/isolation-ac13.test.ts` |
| `AC-13-2` | `SCN-13-2` | — | `eso/control-plane/test/isolation-ac13.test.ts` |
| `AC-13-3` | `SCN-13-3` | — | `eso/control-plane/test/isolation-ac13.test.ts` |
| `AC-14-1` | `SCN-14-1` | — | `eso/control-plane/test/event-read.test.ts` |
| `AC-14-2` | `SCN-14-2` | — | `eso/control-plane/test/audit-write.test.ts` |
| `AC-14-3` | `SCN-14-3` | — | `eso/control-plane/test/event-read.test.ts` |
| `AC-15-1` | `SCN-15-1` | — | `qc/eso-consumers-list.test.mjs` |
| `AC-15-2` | `SCN-15-2` | — | `qc/eso-consumers-list.test.mjs` |
| `AC-15-3` | `SCN-15-3` | — | `qc/eso-consumers-list.test.mjs` |
| `AC-16-1` | `SCN-16-1` | — | `eso/control-plane/test/errors.test.ts` |
| `AC-16-2` | `SCN-16-2` | — | `eso/control-plane/test/ac-legacy-batch1.test.ts` |
| `AC-16-3` | `SCN-16-3` | — | `eso/control-plane/test/ac-legacy-batch1.test.ts` |
| `AC-17-1` | `SCN-17-1` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-17-2` | `SCN-17-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-17-3` | `SCN-17-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-18-1` | `SCN-18-1` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-18-2` | `SCN-18-2` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-18-3` | `SCN-18-3` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-19-1` | `SCN-19-1` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-19-2` | `SCN-19-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-19-3` | `SCN-19-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-20-1` | `SCN-20-1` | — | `eso/control-plane/test/ac-legacy-batch5a.test.ts` |
| `AC-20-2` | `SCN-20-2` | — | `eso/control-plane/test/ac-legacy-batch5a.test.ts` |
| `AC-20-3` | `SCN-20-3` | — | `eso/control-plane/test/ac-legacy-batch5a.test.ts` |
| `AC-21-1` | `SCN-21-1` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-21-2` | `SCN-21-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-21-3` | `SCN-21-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-22-1` | `SCN-22-1` | — | `eso/control-plane/test/ac-legacy-batch4a.test.ts` |
| `AC-22-2` | `SCN-22-2` | — | `eso/control-plane/test/ac-legacy-batch4a.test.ts` |
| `AC-22-3` | `SCN-22-3` | — | `eso/control-plane/test/ac-legacy-batch4a.test.ts` |
| `AC-23-1` | `SCN-23-1` | — | `eso/control-plane/test/ac-legacy-batch4a.test.ts` |
| `AC-23-2` | `SCN-23-2` | — | `eso/control-plane/test/ac-legacy-batch4a.test.ts` |
| `AC-23-3` | `SCN-23-3` | — | `eso/control-plane/test/ac-legacy-batch4a.test.ts` |
| `AC-24-1` | `SCN-24-1` | — | `eso/control-plane/test/ac-legacy-batch5a.test.ts` |
| `AC-24-2` | `SCN-24-2` | — | `eso/control-plane/test/ac-legacy-batch5a.test.ts` |
| `AC-24-3` | `SCN-24-3` | — | `eso/control-plane/test/ac-legacy-batch5a.test.ts` |
| `AC-25-1` | `SCN-25-1` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-25-2` | `SCN-25-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-25-3` | `SCN-25-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-26-1` | `SCN-26-1` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-26-2` | `SCN-26-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-26-3` | `SCN-26-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-27-1` | `SCN-27-1` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-27-2` | `SCN-27-2` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-27-3` | `SCN-27-3` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-28-1` | `SCN-28-1` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-28-2` | `SCN-28-2` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-28-3` | `SCN-28-3` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-29-1` | `SCN-29-1` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-29-2` | `SCN-29-2` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-29-3` | `SCN-29-3` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-30-1` | `SCN-30-1` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-30-2` | `SCN-30-2` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-30-3` | `SCN-30-3` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-31-1` | `SCN-31-1` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-31-2` | `SCN-31-2` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-31-3` | `SCN-31-3` | — | `eso/control-plane/test/ac-legacy-batch2.test.ts` |
| `AC-32-1` | `SCN-32-1` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-32-2` | `SCN-32-2` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-32-3` | `SCN-32-3` | — | `eso/control-plane/test/ac-legacy-batch5c.test.ts` |
| `AC-33-1` | `SCN-33-1` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-33-2` | `SCN-33-2` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-33-3` | `SCN-33-3` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-34-1` | `SCN-34-1` | — | `qc/eso-surfaces.test.mjs` ||
| `AC-34-2` | `SCN-34-2` | — | `qc/eso-surfaces.test.mjs` ||
| `AC-34-3` | `SCN-34-3` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-35-1` | `SCN-35-1` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-35-2` | `SCN-35-2` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-35-3` | `SCN-35-3` | — | `eso/control-plane/test/ac-legacy-batch3.test.ts` |
| `AC-36-1` | `SCN-36-1` | — | `eso/control-plane/test/ac-legacy-batch4b.test.ts` |
| `AC-36-2` | `SCN-36-2` | — | `eso/control-plane/test/ac-legacy-batch4b.test.ts` |
| `AC-36-3` | `SCN-36-3` | — | `eso/control-plane/test/ac-legacy-batch4b.test.ts` |
| `AC-37-1` | `SCN-37-1` | — | `eso/control-plane/test/ac-legacy-batch4b.test.ts` |
| `AC-37-2` | `SCN-37-2` | — | `eso/control-plane/test/ac-legacy-batch4b.test.ts` |
| `AC-37-3` | `SCN-37-3` | — | `eso/control-plane/test/ac-legacy-batch4b.test.ts` |
| `AC-38-1` | `SCN-38-1` | — | `eso/control-plane/test/ac-legacy-batch5b.test.ts` |
| `AC-38-2` | `SCN-38-2` | — | `eso/control-plane/test/ac-legacy-batch5b.test.ts` |
| `AC-38-3` | `SCN-38-3` | — | `eso/control-plane/test/ac-legacy-batch5b.test.ts` |
| `AC-39-1` | `SCN-39-1` | — | `eso/ui/test/onboarding.test.mjs` |
| `AC-39-2` | `SCN-39-2` | — | `eso/ui/test/onboarding.test.mjs` |
| `AC-39-3` | `SCN-39-3` | — | `eso/ui/test/onboarding.test.mjs` |
| `AC-40-1` | `SCN-40-1` | — | `eso/control-plane/test/provisioning-schema.test.ts` |
| `AC-40-2` | `SCN-40-2` | — | `eso/control-plane/test/provisioning-state.test.ts` |
| `AC-40-3` | `SCN-40-3` | — | `eso/control-plane/test/provisioning-api.test.ts` |
| `AC-41-1` | `SCN-41-1` | — | `eso/control-plane/test/ac-legacy-batch5b.test.ts` |
| `AC-41-2` | `SCN-41-2` | — | `eso/control-plane/test/ac-legacy-batch5b.test.ts` |
| `AC-41-3` | `SCN-41-3` | — | `eso/control-plane/test/ac-legacy-batch5b.test.ts` |
