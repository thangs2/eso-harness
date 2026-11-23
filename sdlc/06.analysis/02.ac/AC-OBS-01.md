---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/01.us/US-OBS-01.md"
status: DRAFT
phase: 1
id: AC-OBS-01
type: acceptance-criteria
---

# AC-OBS-01 — `/observatory`: tiêu chí kiểm được

**US:** [`US-OBS-01`](../01.us/US-OBS-01.md) · **REQ:** `REQ-47` · **SCN:** [`SCN-OBS-01`](../03.scn/SCN-OBS-01.md) · **Truy vết:** [`RTM-OBS-01`](../04.rtm/RTM-OBS-01.md)

## 1. Bảng tiêu chí (8 cột)

| AC | Loại | Given (trước) | When (hành động) | Then (mong đợi) | Sau (postcondition) | Test chứng minh | Không kiểm |
|---|---|---|---|---|---|---|---|
| `AC-OBS-01-01` | happy | 2 consumer tồn tại; URL không có `?consumer` | mở `/observatory` | hiện consumer **đầu tiên**; URL **không** bị ghi (chỉ ghi khi đổi select) | URL khớp consumer đang hiện; không có request ghi | qc/eso-observatory-context.test.mjs *(planned)* + manual | không kiểm thứ tự sắp xếp của danh sách consumer |
| `AC-OBS-01-02` | failure | URL có `?consumer=khong-ton-tai` | mở trang | hiện lỗi `OBS_CONSUMER_UNKNOWN` (mã + message); **không** tự đổi sang consumer khác | URL giữ nguyên id sai; không tải dữ liệu consumer khác | qc/eso-observatory-context.test.mjs *(planned)* | không kiểm id sai định dạng (thuộc API) |
| `AC-OBS-01-03` | happy · edge · failure | 500 observation có 3 trace, 7 `prompt.submitted`, 2 `FAIL`, 1 `BLOCKED`; (a) 0 observation; (b) endpoint lỗi 500 | tải trang ở 3 tình huống | 500/3/**7**/3 + Last `at` lớn nhất, nhãn nêu nguồn; (a) 5 KPI = 0 **kèm empty state**; (b) `OBS_UPSTREAM_FAILED`, **không** hiện 0 | lỗi không bị nuốt thành empty; KPI không đổi khi hover/scroll | qc/eso-observatory-kpi.test.mjs *(planned)* | không kiểm lệch múi giờ của `at` · retry policy |
| `AC-OBS-01-04` | happy · edge | consumer có flow default (3 worker) + 1 flow draft; (a) chưa có flow published | tải trang | flow default nếu có, ngược lại published mới nhất, ngược lại `flows[0]`; 2 view dùng **cùng** node/cạnh; (a) text `No published flow for this consumer.` (không phát mãy), phần còn lại vẫn tải | không có node của flow draft | qc/eso-observatory-graph.test.mjs *(planned)* | không kiểm vị trí pixel · flow published nhưng 0 node |
| `AC-OBS-01-05` | happy · edge · failure | trace `T1` có 4 event; có trace khác chứa chuỗi "deploy" | (1) nhập đúng `T1`; (2) nhập "deploy"; (3) nhập "zzz"; (4) nhập rỗng | (1) phát 4 event; (2) khớp trace đầu tiên chứa chuỗi; (3) `OBS_TRACE_NOT_MATCHED`; (4) `OBS_QUERY_EMPTY` | phát xong tự dừng; `Stop` dừng ngay | qc/eso-observatory-pulse.test.mjs *(planned)* | không kiểm tốc độ thực tế (450 ms) |
| `AC-OBS-01-06` | happy · edge | 120 request, 3 host, 40 prompt con | lọc theo host + bật `Failures only` + sang trang 2 + expand 1 trace | đúng tập lọc; trang 2 hiện dòng 51–100; expand hiện prompt con `source ≠ agent` | bộ lọc giữ khi đổi trang | qc/eso-observatory-grid.test.mjs *(planned)* | không kiểm nội dung prompt body (bị cấm hiện) |
| `AC-OBS-01-07` | failure · rbac | (a) API trả 500; (b) phiên hết hạn (401); (c) consumer bị từ chối (403) | tải trang | (a) `OBS_UPSTREAM_FAILED`; (b) (c) `OBS_DENIED` — luôn **mã + message** | không màn trắng, không lỗi thô | qc/eso-observatory-errors.test.mjs *(planned)* | không kiểm nội dung message của server |
| `AC-OBS-01-08` | happy | trang đã tải | tương tác toàn bộ: đổi consumer · đổi view · play/stop · lọc · phân trang · expand | **0** request `POST/PUT/DELETE/PATCH` trong network log | dữ liệu không đổi trên server | qc/eso-observatory-readonly.test.mjs *(planned)* | không kiểm request do extension trình duyệt |

> Edge/failure được **gộp trong chính AC** (cột Loại ghi rõ) để giữ đúng 8 AC đã trace ở FRD/SRS.

## 2. Postconditions

- `AC-OBS-01-01` → consumer đầu tiên được nạp; URL **không** đổi khi mở trang.
- `AC-OBS-01-02` → URL giữ id sai; không có dữ liệu của consumer khác được nạp.
- `AC-OBS-01-03` → không có state KPI bị ghi đè bởi lần tải lỗi.
- `AC-OBS-01-04` → graph dùng flow đã chọn theo thứ tự default → published mới nhất → `flows[0]`; flow rỗng render text (không mã).
- `AC-OBS-01-05` → timer bị clear; không có interval sống sau khi rời trang.
- `AC-OBS-01-06` → bộ lọc + vị trí trang không mất khi expand.
- `AC-OBS-01-07` → mọi lỗi đi qua một đường hiển thị duy nhất có mã.
- `AC-OBS-01-08` → server state bất biến.

## 3. Test chứng minh (đường kiểm)

| Tầng | Cách |
|---|---|
| L1 unit | hàm thuần: KPI, chọn flow, khớp pulse, lọc/phân trang, tone trạng thái |
| L2 API | 8 endpoint: 200 + shape; 401/403; 404 consumer; 500 |
| L3 UI | 8 AC ở trên, cùng network log cho `AC-OBS-01-08` |
| L4 smoke | mở `/observatory` trên consumer thật, chụp 6 trạng thái (⑦ §11) |

**Chưa có test nào** — **7** file dự kiến trong `qc/` (đều **chưa tồn tại**; reverify 2026-11-23 xác nhận): `context`, `kpi`, `graph`, `pulse`, `grid`, `errors`, `readonly`.

## 4. AC này **không** kiểm

- Không kiểm phi chức năng (hiệu năng, tải 10k event) — thuộc `NFR`.
- Không kiểm quyền **per-consumer** (`OPEN-OBS-ACL`) — chỉ 401/403.
- Không kiểm nội dung prompt/secret (bị cấm hiện).
- Không kiểm 3D event graph (Phase 2 của `F-42`).

## 5. Trace

`P4` · `P7` · `P6` → `G-V` → `BR-46` · `BR-12` · `BR-05` → `F-42` → `REQ-47` → `US-OBS-01` → `AC-OBS-01-01…08`
