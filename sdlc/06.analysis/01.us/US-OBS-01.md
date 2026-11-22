---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/05.requirements/01.specification/04.srs/03.functional-requirements.md"
status: DRAFT
phase: 1
id: US-OBS-01
type: user-story
---

# US-OBS-01 — Operator thấy một consumer đã làm gì, không cần đọc log thô

**REQ:** `REQ-47` · **Năng lực:** `F-42` (bề mặt §7) · **Actor:** A-01 (operator, đọc) · **AC:** [`AC-OBS-01`](../02.ac/AC-OBS-01.md)
**Slice:** [`D-128`](../../03.inception/02.decision-log/11.option-e-mot-noi-dung-mot-nha.md) · page `/observatory`

## 1. Story

*Là* **A-01**, *tôi muốn* mở một trang cho một consumer và thấy ngay: nó đang được cấu hình gì, có bao nhiêu hoạt động, công việc đi qua những worker nào, và một lượt chạy cụ thể đã xảy ra ra sao —
*để* tôi trả lời được "hệ đã làm gì" mà **không** phải đọc log thô hay ghép nhiều màn hình.

## 2. Giá trị & vì sao không gộp

| | |
|---|---|
| **Giá trị** | `P7` (bằng chứng phải đo nội dung, không đo lượt đọc) + `P4` (đủ để thực thi chưa) có chỗ **nhìn**; `V3` (người thứ ba audit một turn) có đường đi |
| **Vì sao không gộp** | đây là **bề mặt đọc** của `F-42`; `F-42` đặc tả cơ chế event/2D/3D. Gộp sẽ trộn "hệ ghi gì" với "người đọc thấy gì" — hai subject, hai owner |

## 3. Trong / ngoài phạm vi

| Trong | Ngoài |
|---|---|
| ngữ cảnh consumer (read-only) · 5 KPI · đồ thị worker 2 view · live pulse · bảng request + prompt con · đường lỗi `OBS_*` | sửa cấu hình consumer (`/consumers/:id/settings`) · quản lý flow (`/consumers/:id/flows`) · 3D event graph (Phase 2 của `F-42`) · phân quyền per-consumer (`OPEN-OBS-ACL`) |

## 4. AC

| AC | Loại | Một dòng |
|---|---|---|
| `AC-OBS-01-01` | happy | mở không `?consumer` ⇒ consumer đầu tiên + URL được ghi |
| `AC-OBS-01-02` | failure | `?consumer` không tồn tại ⇒ `OBS_CONSUMER_UNKNOWN`, **không** im lặng đổi |
| `AC-OBS-01-03` | happy · edge | 5 KPI đúng nguồn; 0 event ⇒ 0; lỗi tải ⇒ `OBS_UPSTREAM_FAILED` (không phải 0) |
| `AC-OBS-01-04` | happy · edge | graph chỉ từ flow published; chưa publish ⇒ empty |
| `AC-OBS-01-05` | happy · edge · failure | pulse khớp exact → substring → lỗi rõ ràng |
| `AC-OBS-01-06` | happy · edge | grid: lọc · nhóm · phân trang 50 · expand prompt con |
| `AC-OBS-01-07` | failure · rbac | mọi lỗi hiện **mã + message**; 401/403 ⇒ `OBS_DENIED` |
| `AC-OBS-01-08` | happy | read-only: 0 request ghi khi tương tác toàn trang |

## 5. Phụ thuộc

| Phụ thuộc | Trạng thái |
|---|---|
| `knowledge_observation` là nguồn duy nhất | ✅ DDL có; chi tiết ở `07.technical/02.data-design` + `03.api` (TECH của page = `N/A`, 0 delta) |
| mã lỗi `OBS_*` | ✅ danh mục ở SRS `04` §6 — **code chưa có**, `AC-OBS-01-07` sẽ đỏ tới khi build |
| `OPEN-OBS-ACL` | ⏳ mở, không chặn slice (denied = 401/403) |
