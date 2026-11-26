---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/05.requirements/01.specification/04.srs/03.functional-requirements.md"
status: DRAFT
phase: 2
id: US-OBS-02
type: user-story
---

# US-OBS-02 — Operator & Auditor kiểm chứng đủ bằng chứng của một prompt request

**REQ:** `REQ-47` · **Năng lực:** `F-42` (bề mặt §7b) · **Actor:** A-01 (operator, đọc) · A-04 (auditor, đọc) · **AC:** [`AC-OBS-02`](../02.ac/AC-OBS-02.md)
**Slice:** [`D-128`](../../03.inception/02.decision-log/11.option-e-mot-noi-dung-mot-nha.md) · [`29.observatory-v2-evident-sufficiency-analysis.md`](../../02.governance/02.records/29.observatory-v2-evident-sufficiency-analysis.md) · page `/observatory/requests/:requestId` ([`20.request-detail.md`](../../08.ui-design/20.pages/20.request-detail.md))

## 1. Story

*Là* **A-01 / A-04**, *tôi muốn* mở một prompt request tại `/observatory/requests/:requestId` và nhìn thấy ngay phán quyết Turn Proof mặc định (`Proof First`), bảng đo **5-Axis Evidence Effectiveness**, cổng tiền thực thi (`PRE Pre-turn gate`), các khoảng trống & điều chưa biết tường minh (`Explicit Unknowns`), trạng thái niêm phong & nguồn đã xác minh (`Receipt v2`), cùng nhánh cải thiện đọc-only (`Learn → Train Handoff`) —
*để* tôi kiểm chứng được prompt có tìm đúng – đủ – chính xác ngữ cảnh không và biết nguyên nhân gốc cần sửa mà **không** phải suy đoán số liệu hay ghép nhiều màn hình.

## 2. Giá trị & vì sao không gộp

| | |
|---|---|
| **Giá trị** | Nối vòng kín `P4` (đủ để thực thi chưa) · `P7` (đo nội dung đã kiểm chứng, không đo lượt đọc) · `P5` (phân loại bệnh `form/obligation/model/retrieval` sang Learning Loop) · `V3` (người thứ ba đối chiếu độc lập `Receipt v2` + `Spec Ref`) |
| **Vì sao không gộp** | `US-OBS-01` phục vụ bề mặt danh sách/tổng quan `/observatory`; `US-OBS-02` phục vụ bề mặt kiểm chứng từng request (`/observatory/requests/:requestId`, `F-42 §7b`) với mô hình 5 trục, `Pre-turn gate`, `Explicit Unknowns`, và `Receipt v2` |

## 3. Trong / ngoài phạm vi

| Trong | Ngoài |
|---|---|
| Hợp nhất route về `/observatory/requests/:requestId` + redirect route cũ · `5-Axis Evidence Effectiveness` (`MET-08`, `P4`, `P7`, `EXEC`, `P5`) · Turn Verdict & chống đếm trùng gap · `Q3 Turn Proof` + `BR-18 Explicit Unknowns` + `PRE Pre-turn gate` · `Receipt v2` server verification & `sources[]` · `Q6` grouped codes + 8-step Stepper/Flow/Guides · read-only (`D-47`) + Learn→Train navigation · server-side actor trust & host collector/emitter | Sửa dữ liệu/quyết định trên UI · chạy lại request từ detail page · tự động duyệt/áp dụng proposal Learning (`D-07` / `BR-15`) · cô lập đa tenant (`OUT` ở baseline) |

## 4. AC

| AC | Loại | Một dòng |
|---|---|---|
| `AC-OBS-02-01` | happy · edge | Entry, redirects (`/requests/:id`, `/observatory-v2/requests/:id`), `combineLatest` + `lastLoadKey` + `loadSeq` guard, tab mặc định `'decisions'` (Proof First) |
| `AC-OBS-02-02` | happy · edge | 5-Axis Evidence Effectiveness (`MET-08`, `P4`, `P7`, `EXEC`, `P5`) chỉ dựng từ API thật (`BR-12`), responsive `0px` tràn ngang (`1440×900` & `375×812`) |
| `AC-OBS-02-03` | happy · edge · failure | Turn Verdict S0/Bug#4 (`HOST_SILENT`/`partial`/`unknown` đều chạy `proofGaps()`, `UNSPECIFIED_*`, `EVIDENCE_UNVERIFIED`, `dedupeGaps`, tách `CORE_PROOF_CODES`, ledger 5 dòng + `+N more`) |
| `AC-OBS-02-04` | happy · edge · failure | `Q3 Turn Proof` + `BR-18 Explicit Unknowns` + `PRE Pre-turn gate` (`evidence.judgment`); lỗi endpoint tùy chọn (`422 INVALID_TASK`, `404` receipt) hạ cấp thành Explicit Unknowns không chặn trang |
| `AC-OBS-02-05` | happy · failure | S2/S5 server verification (`evidence.verified`) + Receipt v2 `sources[]` (`Q5 Integrity` gọi `verifyReceipt`, bảng `Receipt v2 Verified Sources` có `overflow-x: auto`, không tự nhận `verified`) |
| `AC-OBS-02-06` | happy · edge | `Q6 What next` gom nhóm mã gap lặp (`CODE ×N`, wrap pill), 8-step Pipeline Stepper + E2E Flow + dialog `VerdictGuide` & `StepGuide` |
| `AC-OBS-02-07` | happy · failure · rbac | Read-only (`D-47`), `authGuard`, 401/403 denied, 404 request không tồn tại, 4 nhánh Learn→Train chỉ điều hướng read-only (chỉ cho phép telemetry `POST /api/v1/telemetry/ui`) |
| `AC-OBS-02-08` | happy · failure | Server-side actor trust S1 (`workerId → (role, bar)`, không spoof `actor.kind`) + host-runtime S3 collector/emitter (`evidence.packet` SHA-256 + `action.recorded` + `decision.recorded`) |

## 5. Phụ thuộc

| Phụ thuộc | Trạng thái |
|---|---|
| `20.request-detail.md` (`v3.0.0`, B1–B20) & Option A consolidation | ✅ Đã hợp nhất vào `features/observatory/` |
| Endpoint detail / receipt / verify / knowledge sufficiency / telemetry | ✅ Có trên control-plane (`server.ts`) |
| Suite unit & contract kiểm chứng (`eso/ui/test/`, `eso/control-plane/test/`, `host-runtime/test/`, `qc/`) | ✅ Đã tồn tại trên đĩa (8 file test trong [`RTM-OBS-02`](../04.rtm/RTM-OBS-02.md)) |
