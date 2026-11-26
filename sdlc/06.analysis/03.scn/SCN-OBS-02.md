---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-OBS-02.md"
status: DRAFT
phase: 2
id: SCN-OBS-02
type: scenario-matrix
---

# SCN-OBS-02 — kịch bản kiểm `/observatory/requests/:requestId`

**AC:** [`AC-OBS-02`](../02.ac/AC-OBS-02.md) · **Truy vết:** [`RTM-OBS-02`](../04.rtm/RTM-OBS-02.md)
> **Nhà của nội dung này:** kịch bản. Cardinality: **1 `AC` → n `SCN`** — một tiêu chí có nhiều tình huống.

## 1. Ma trận

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-OBS-02-01` | `AC-OBS-02-01` | happy | Người dùng đã đăng nhập; mở `/requests/req-1` hoặc `/observatory-v2/requests/req-1` | Điều hướng tới route cũ hoặc mở trực tiếp `/observatory/requests/req-1` | Redirect về `/observatory/requests/req-1`; feature `observatory-v2` không còn tồn tại; tab mặc định mở là `'decisions'` (Proof First) | yes |
| `SCN-OBS-02-02` | `AC-OBS-02-01` | edge | Đang mở `consumer-a::req-1`; người dùng chuyển nhanh sang `consumer-b::req-2` khi request cũ chưa trả về | `combineLatest([paramMap, queryParamMap])` phát sự kiện mới | `lastLoadKey` chặn gọi trùng cùng key; `loadSeq` hủy kết quả của `req-1` để không ghi đè state của `req-2` | yes |
| `SCN-OBS-02-03` | `AC-OBS-02-02` | happy | Trace có đủ telemetry files/tools, recon, action events (`readBeforeEdit=true`), pre-turn gate `sufficient`, `Receipt v2` verified, `kbSufficiency` clear | Render `<eso-evidence-effectiveness>` | `buildEvidenceEffectivenessView` trả `overallStatus='effective'`, `capturedAxes=5`, `axis1.ratioPct=100`, `axis2.diagnosisKind='sufficient'`, `axis3.verifiedCount=1`, `axis4.totalTokens=2000` | yes |
| `SCN-OBS-02-04` | `AC-OBS-02-02` | edge | Trace thưa (`verdict=null`, `effectiveness=null`, `events=[]`, `telemetry` rỗng) hoặc viewport `1440×900` và `375×812` | Render `<eso-evidence-effectiveness>` và `.detail-page` | `overallStatus='cannot-judge'`, mọi metric thiếu là `null` / `not-captured` (`BR-12`); `.detail-page` (`overflow-x: clip`) và `.ee-grid` (`minmax(0,1fr)`) giữ `0px` tràn ngang | yes |
| `SCN-OBS-02-05` | `AC-OBS-02-03` | happy | Trace có đủ `decision.recorded(allow)` + `evidence.packet` + `actor` + `action.recorded`, và verdict có ≥6 gap | Chạy `adjudicate()` và render `GlanceCards` | `level='allow'`, `score=100`, `gaps=[]`; khi có >5 gap, `GlanceCards` tách rạch ròi `CORE_PROOF_CODES` khỏi `extraJudgmentGaps` và cắt bảng ledger ở 5 dòng + `+N more` | yes |
| `SCN-OBS-02-06` | `AC-OBS-02-03` | edge | Host khai `partial`/`unknown` không kèm gap, hoặc có 19 `PRE_GAP` trùng nội dung với 19 `JUDGMENT_GAP_UNKNOWN` | Chạy `adjudicate()` và `dedupeGaps(preGaps, postGaps)` | Sinh `UNSPECIFIED_PARTIAL`/`UNSPECIFIED_UNKNOWN` (`score=75`, không bao giờ `score=100 · 0 gap`); `dedupeGaps` gộp `19 + 19 ⇒ 19` (không thành `38`) | yes |
| `SCN-OBS-02-07` | `AC-OBS-02-03` | failure | Trace mù hoàn toàn (chỉ có `prompt.submitted`, thiếu `decision`, `packet`, `actor`, `action`) hoặc `evidence.verified(allVerified=false)` | Chạy `adjudicate()` | Trace mù chạy đủ `proofGaps()` nhận 4 gap (`HOST_SILENT`, `EVIDENCE_MISSING`, `ACTOR_MISSING`, `ACTION_MISSING`) ⇒ `score=0`; `allVerified=false` hạ `allow → partial` + `EVIDENCE_UNVERIFIED` (`score=75`) | yes |
| `SCN-OBS-02-08` | `AC-OBS-02-04` | happy | Trace có observation mang `evidence.judgment` (`decision='block'`, `enforcement='enforce'`, `gap_items`) và một số chiều evidence thiếu | Tải tab `decisions` và gọi `toPreTurnGate` + `collectExplicitUnknowns` | `Q3 Turn Proof` hiện đúng tiêu đề; khối `PRE Pre-turn gate` hiện `level`, `decision`, `enforcement`, `gaps[domain='pre']`; `BR-18 Explicit Unknowns` liệt kê các chiều thiếu | yes |
| `SCN-OBS-02-09` | `AC-OBS-02-04` | edge | Trace chỉ có `action.recorded`, không có observation mang `evidence.judgment` | Gọi `toPreTurnGate(events)` | Trả `null`, khối `PRE Pre-turn gate` không render giả và được ghi nhận trong `Explicit Unknowns` (`no-pre-turn-judgment`) | yes |
| `SCN-OBS-02-10` | `AC-OBS-02-04` | failure | `getRequestDetail` thành công, nhưng `getRequestReceipt` trả `404` và `getConsumerKnowledgeSufficiency` trả `422 INVALID_TASK` | Tải trang trong `RequestDetailPage.load()` | Hai call phụ `.catch(() => null)` không chặn trang; `Explicit Unknowns` liệt kê `no-receipt-payload` và `kb-sufficiency-unavailable` | yes |
| `SCN-OBS-02-11` | `AC-OBS-02-05` | happy | Host gửi `evidence.packet` hợp lệ (`kind='knowledge'|'file'` + `requirementId`) và `Receipt v2` có `sources[]` | Ingest observation (S2), issue & verify `Receipt v2`, mở `Q5 Integrity` | Server tạo `evidence.verified(allVerified=true)`; UI gọi `verifyReceipt`, đặt `'verified'`, và render bảng `Receipt v2 Verified Sources (sources[])` (`requirementId`, `where`, `hash`, `verified`, `verifiedAt`) | yes |
| `SCN-OBS-02-12` | `AC-OBS-02-05` | failure | `evidence.packet` bị giả mạo hash/file thiếu, hoặc payload receipt bị tamper, hoặc `verifyReceipt` lỗi mạng | Ingest packet hoặc mở `Q5 Integrity` | Server append `evidence.verified(allVerified=false)`; `verifyReceipt` trả `'failed'` hoặc `'unavailable'` (không bao giờ giả định `'verified'`); `Q5` hiển thị rõ trạng thái lỗi/chưa verify | yes |
| `SCN-OBS-02-13` | `AC-OBS-02-06` | happy | Verdict có nhiều gap lặp cùng `code`; trace có các bước pipeline | Xem `Q6 What next`, `PipelineStepper`, `PipelineFlow`, và bấm `Full explanation` / `?` | `Q6` gom nhóm `CODE ×N` trong `.next-codes` (`flex-wrap: wrap`); 8 bước Pipeline hiện đủ; `VerdictGuide` & `StepGuide` mở qua native `<dialog>` và khớp `REQUEST_SPEC_REF` | yes |
| `SCN-OBS-02-14` | `AC-OBS-02-06` | edge | Một số trong 8 bước pipeline chưa có event | Xem `PipelineStepper`, `PipelineFlow`, và `StepGuide` | Các bước thiếu hiện `not captured`; `StepGuide` ở bước Sufficiency ghi rõ turn proof score khác với knowledge sufficiency | yes |
| `SCN-OBS-02-15` | `AC-OBS-02-07` | happy | Request có gaps/unknowns kích hoạt cả 4 nhánh `form`, `obligation`, `model`, `retrieval` trong Axis 5 | Mở trang, bấm chuyển tab, expand step, và kiểm tra `targetRoute` của 4 nhánh Axis 5 | 0 mutation API trên domain data (`D-47`); 4 nhánh điều hướng read-only sang `/consumers/:id/settings?tab=knowledge`, `/learning`, `/architecture`; chỉ phát beacon telemetry `POST /api/v1/telemetry/ui` | yes |
| `SCN-OBS-02-16` | `AC-OBS-02-07` | rbac | Phiên chưa đăng nhập hoặc token hết hạn/không đủ quyền (401/403) | Mở `/observatory/requests/:requestId` hoặc gọi API detail | `authGuard` chặn trước khi render và chuyển `/login?returnUrl=`; API 401/403 hiện `.error-panel` với mã/thông báo từ server | no |
| `SCN-OBS-02-17` | `AC-OBS-02-07` | failure | `:requestId` không tồn tại trong consumer | Gọi `GET /api/v1/consumers/:id/requests/:requestId` hoặc `ensureVerdict` | Trả `404 NOT_FOUND`, không bịa verdict hay ghi dòng vào `turn_verdict`; UI hiện `.error-panel` kèm link `← Requests` | yes |
| `SCN-OBS-02-18` | `AC-OBS-02-08` | happy | Store có `worker-build` với `(role='builder', bar)` và `host-runtime` chạy trên `cwd` có file thật (`AGENTS.md`, `src/app.ts`) | Gọi `JudgmentService.evaluate` với `actor` & `workerId`; chạy `collectLocalAnswers` | Server giữ `authenticated_kind` thật, ép `role`/`bar` từ store; `collectLocalAnswers` tạo `answers` (`basis='verified'`, `exists='present'`), `packetItems` SHA-256 deterministic và emit `evidence.packet` + `action.recorded` + `decision.recorded` | yes |
| `SCN-OBS-02-19` | `AC-OBS-02-08` | failure | Client gửi `actor.kind='machine'` giả mạo và hạ chuẩn `role.bar`; `host-runtime` gặp file thiếu hoặc `../outside.txt` | Gọi `JudgmentService.evaluate` (S1) và `collectLocalAnswers` (S3) | Server từ chối spoof `actor.kind` và reject/block theo `bar` thật của store (`INSUFFICIENT` → `block`); `collectLocalAnswers` ghi `exists='absent'`, `hash=null`, `packetItems=[]`, `packetHash=null` | yes |

## 2. `OUT` — có lý do

| type | Lý do |
|---|---|
| `tenant` | `OUT`: baseline **chưa có multi-tenant** (P2 = Expansion); `F-42` đọc observation theo từng consumer được cô lập theo schema riêng. Khi mở multi-tenant ở pha sau phải bổ sung ma trận kịch bản tenant trước |
