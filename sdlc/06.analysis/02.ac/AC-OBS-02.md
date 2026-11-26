---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/01.us/US-OBS-02.md"
status: DRAFT
phase: 2
id: AC-OBS-02
type: acceptance-criteria
---

# AC-OBS-02 — `/observatory/requests/:requestId`: tiêu chí kiểm được

**US:** [`US-OBS-02`](../01.us/US-OBS-02.md) · **REQ:** `REQ-47` · **SCN:** [`SCN-OBS-02`](../03.scn/SCN-OBS-02.md) · **Truy vết:** [`RTM-OBS-02`](../04.rtm/RTM-OBS-02.md) · **UI:** [`20.request-detail.md`](../../08.ui-design/20.pages/20.request-detail.md)

## 1. Bảng tiêu chí (8 cột)

| AC | Loại | Given (trước) | When (hành động) | Then (mong đợi) | Sau (postcondition) | Test chứng minh | Không kiểm |
|---|---|---|---|---|---|---|---|
| `AC-OBS-02-01` | happy · edge | Người dùng đã đăng nhập; route cũ `/requests/:id` hoặc `/observatory-v2/requests/:id`, hoặc chuyển liên tiếp `:requestId`/`?consumer=` trên cùng component | Mở hoặc chuyển tham số route detail | Redirect về `/observatory/requests/:requestId`; `activeTab` mặc định `'decisions'` (Proof First); `combineLatest([paramMap, queryParamMap])` + `lastLoadKey` tránh tải trùng; `loadSeq` loại bỏ response cũ | Không có `features/observatory-v2/` tách rời; state phản ánh đúng cặp `consumer::requestId` cuối cùng | `eso/ui/test/observatory-revamp.test.mjs` | Không kiểm thứ tự CSS animation |
| `AC-OBS-02-02` | happy · edge | Request có dữ liệu đầy đủ 5 trục hoặc dữ liệu thưa (`verdict=null`, `events=[]`, `telemetry` rỗng) | Render `<eso-evidence-effectiveness>` ở `1440×900` và `375×812` | Chỉ tính từ API thật (`BR-12`): đủ dữ liệu ⇒ `overallStatus='effective'` (`5/5` trục); thiếu dữ liệu ⇒ `cannot-judge` / `not-captured` (`null`, không bịa `0`/`100`); `.detail-page` (`overflow-x: clip`) + `.ee-grid` giữ `0px` tràn ngang | Không có số liệu bịa; layout không tràn ngang ở cả desktop lẫn mobile | `eso/ui/test/observatory-revamp.test.mjs` | Không kiểm ảnh chụp pixel runtime trình duyệt |
| `AC-OBS-02-03` | happy · edge · failure | Trace có (a) đủ chứng cứ `allow`; (b) `HOST_SILENT` / `partial` / `unknown` không nêu gap; (c) gap lặp giữa pre-turn (`PRE_GAP`) và post-turn (`JUDGMENT_GAP_UNKNOWN`); (d) `evidence.verified(allVerified=false)` | Tính `adjudicate()`, `dedupeGaps()`, và render `GlanceCards` | Nhánh `HOST_SILENT`, `partial`, `unknown` đều chạy đủ `proofGaps()` (`HOST_SILENT` im lặng hoàn toàn ⇒ 4 gap, `score=0`); host khai `partial`/`unknown` không gap ⇒ `UNSPECIFIED_PARTIAL`/`UNSPECIFIED_UNKNOWN` (`score=75`); `evidence.verified(allVerified=false)` hạ `allow → partial` + `EVIDENCE_UNVERIFIED`; `dedupeGaps` gộp `19 + 19 ⇒ 19`; `CORE_PROOF_CODES` tách khỏi `extraJudgmentGaps`; bảng ledger cắt 5 dòng + `+N more` | Không bao giờ trả `score=100 · 0 gap` cho `partial`/`unknown`; không đếm trùng pre/post | `eso/control-plane/test/verdict.test.ts` · `eso/ui/test/observatory-revamp.test.mjs` | Không kiểm công thức ngoài `max(0, 100 − 25 × số_gap)` |
| `AC-OBS-02-04` | happy · edge · failure | Request có hoặc không có `evidence.judgment`; endpoint phụ `GET .../knowledge/sufficiency` trả `422 INVALID_TASK` hoặc `GET .../receipt` trả `404` | Tải trang và mở tab `decisions` | Nhãn `Q3 Turn Proof`; hiển thị `PRE Pre-turn gate` khi có `evidence.judgment` (vắng ⇒ `null`, không bịa); lỗi `receipt`/`kbSufficiency` degrade mượt qua `.catch(() => null)` và liệt kê tường minh trong `BR-18 Explicit Unknowns` (`no-receipt-payload`, `kb-sufficiency-unavailable`) | Trang vẫn mở thành công từ `getRequestDetail`; mọi chiều thiếu đều lộ trong `Explicit Unknowns` | `eso/ui/test/turn-proof-sufficiency.test.mjs` · `eso/ui/test/observatory-revamp.test.mjs` | Không kiểm logic sinh finding chi tiết trong KB service |
| `AC-OBS-02-05` | happy · failure | `evidence.packet` hợp lệ hoặc bị giả mạo (`allVerified=false`); `Receipt v2` có `sources[]` hoặc bị sửa payload/mất `verifyReceipt` | Ingest `evidence.packet` (S2), issue & verify `Receipt v2` (S5), mở `Q5 Integrity` | Server verify predicate khi ingest (S2) ghi `evidence.verified`; `Q5 Integrity` gọi `verifyReceipt`, reset trạng thái về `'unavailable'` trước mỗi lần load, render bảng `Receipt v2 Verified Sources (sources[])` bọc `.sources-table-wrap` (`overflow-x: auto`); hash lệch hoặc verify lỗi ⇒ `'failed'`/`'unavailable'`, tuyệt đối không mặc định `'verified'` | Toàn vẹn chuỗi hash-chain + HMAC + nguồn gốc kiểm chứng được độc lập | `eso/control-plane/test/evidence-predicate.test.ts` · `eso/control-plane/test/receipt.test.ts` · `eso/ui/test/observatory-revamp.test.mjs` | Không kiểm quản lý khóa KMS ngoài `ESO_RECEIPT_KEY` |
| `AC-OBS-02-06` | happy · edge | Verdict có các mã gap lặp lại; pipeline có bước có dữ liệu và bước thiếu dữ liệu | Xem `Q6 What next`, 8-step `PipelineStepper`, `PipelineFlow`, và mở `VerdictGuide` / `StepGuide` | `Q6` gom nhóm mã gap lặp thành `CODE ×N` trong `.next-codes` (`flex-wrap: wrap`); 8 bước Pipeline Stepper & E2E Flow hiện trạng thái `not captured` cho bước thiếu; `VerdictGuide` & `StepGuide` mở qua `<dialog>` (`StepGuide` phân biệt rõ turn proof score với knowledge sufficiency) | Người đọc thấy bước tiếp theo gọn gàng và hiểu từng bước mà không rời trang | `eso/ui/test/observatory-revamp.test.mjs` · `eso/ui/test/turn-proof-sufficiency.test.mjs` · `qc/eso-request-spec-ref.test.mjs` | Không kiểm vị trí cuộn pixel của `scrollIntoView` |
| `AC-OBS-02-07` | happy · failure · rbac | (a) Chưa đăng nhập; (b) API trả 401/403; (c) `:requestId` không tồn tại (404); (d) Đã tải trang và bấm link ở Axis 5 (`form`/`obligation`/`model`/`retrieval`) | Truy cập URL hoặc tương tác toàn trang | (a) `authGuard` chuyển `/login?returnUrl=`; (b) `.error-panel` báo lỗi từ chối từ server; (c) 404 không bịa verdict, hiện `.error-panel`; (d) 0 mutation API trên dữ liệu domain (`D-47`), 4 nhánh Learn→Train chỉ điều hướng read-only (`/consumers/:id/settings?tab=knowledge`, `/learning`, `/architecture`); chỉ cho phép telemetry `POST /api/v1/telemetry/ui` | Server state domain bất biến; không rò dữ liệu khi chưa xác thực | `eso/ui/test/observatory-revamp.test.mjs` · `eso/control-plane/test/verdict.test.ts` | Không kiểm quyền per-consumer chi tiết (`OPEN-OBS-ACL`) |
| `AC-OBS-02-08` | happy · failure | (a) Client gửi `actor.kind` giả mạo hoặc `role.bar` hạ chuẩn so với `workerId` trong store; (b) `host-runtime` thu thập file cục bộ (hợp lệ hoặc thiếu/traversal `../`) và phát event | Đánh giá judgment (S1) và chạy collector/emitter ở `host-runtime` (S3) | (a) Server giữ `authenticated_kind` thật (không cho spoof `actor.kind`) và ép `(role, bar)` cấu hình theo `workerId` trong store; (b) `collectLocalAnswers` hash SHA-256 deterministic cho file thật thành `evidence.packet` + `action.recorded` + `decision.recorded`, còn file thiếu/traversal ghi `exists='absent'` và không bao giờ tạo `packetItems` giả | Tin cậy danh tính & bằng chứng xuất phát từ server/filesystem thật, chống giả mạo từ client | `eso/control-plane/test/judgment.service.test.ts` · `host-runtime/test/answer-collector.test.ts` | Không kiểm sandbox OS-level ngoài đường dẫn dưới `cwd` |

## 2. Postconditions

- `AC-OBS-02-01` → Chỉ tồn tại một feature `observatory/` chính thức; `lastLoadKey` + `loadSeq` chặn race condition khi chuyển route.
- `AC-OBS-02-02` → `buildEvidenceEffectivenessView` trả `null` cho metric thiếu (`BR-12`); không tràn ngang ở mọi breakpoint.
- `AC-OBS-02-03` → `partial`/`unknown` luôn có ít nhất 1 gap và `score < 100`; `dedupeGaps` chống đếm trùng pre/post.
- `AC-OBS-02-04` → Mọi thiếu hụt dữ liệu hoặc lỗi endpoint phụ được liệt kê trong `Explicit Unknowns` (`BR-18`).
- `AC-OBS-02-05` → `receiptVerification` luôn khởi tạo `'unavailable'` và chỉ chuyển `'verified'` sau `verifyReceipt` thành công.
- `AC-OBS-02-06` → `Q6` wrap pill sạch sẽ; 8 bước Pipeline và 2 dialog hướng dẫn mở/đóng an toàn.
- `AC-OBS-02-07` → Toàn bộ tương tác trang giữ bất biến dữ liệu domain (`D-47`), ngoại trừ beacon telemetry.
- `AC-OBS-02-08` → Server ép actor & bar thật từ store (S1); collector host-runtime không bao giờ hash file ngoài `cwd` hay bịa `present` (S3).

## 3. Test chứng minh (đường kiểm thực tế)

| Tầng | File test tồn tại trên đĩa |
|---|---|
| L1/L3 UI & Selector | `eso/ui/test/observatory-revamp.test.mjs` · `eso/ui/test/turn-proof-sufficiency.test.mjs` |
| L1/L2 Control-Plane | `eso/control-plane/test/verdict.test.ts` · `eso/control-plane/test/receipt.test.ts` · `eso/control-plane/test/evidence-predicate.test.ts` · `eso/control-plane/test/judgment.service.test.ts` |
| L1/L2 Host Runtime | `host-runtime/test/answer-collector.test.ts` |
| L1 Contract Doc↔Code | `qc/eso-request-spec-ref.test.mjs` |

## 4. AC này **không** kiểm

- Không kiểm cô lập dữ liệu đa tenant (`OUT` ở baseline — xem [`SCN-OBS-02`](../03.scn/SCN-OBS-02.md) §2).
- Không kiểm hiệu năng tải hàng chục nghìn observation (thuộc `NFR`).
- Không kiểm nội dung bí mật/prompt thô bị cấm lưu vào receipt (`ReceiptService` chỉ giữ digest).

## 5. Trace

`P4` · `P5` · `P7` → `G-V` · `G-K` → `BR-12` · `BR-15` · `BR-18` · `BR-46` → `F-42` (`§7b`) → `REQ-47` → `US-OBS-02` → `AC-OBS-02-01…08`
