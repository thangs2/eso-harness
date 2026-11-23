---
sot_doc_version: "1.0.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-OBS-01.md"
status: DRAFT
phase: 1
id: SCN-OBS-01
type: scenario-matrix
---

# SCN-OBS-01 — kịch bản kiểm `/observatory`

**AC:** [`AC-OBS-01`](../02.ac/AC-OBS-01.md) · **Truy vết:** [`RTM-OBS-01`](../04.rtm/RTM-OBS-01.md)
> **Nhà của nội dung này:** kịch bản. Cardinality: **1 `AC` → n `SCN`** — một tiêu chí có nhiều tình huống.

## 1. Ma trận

| SCN | AC | type | Given | When | Then | automated |
|---|---|---|---|---|---|---|
| `SCN-OBS-01-01` | `AC-OBS-01-01` | happy | 2 consumer; URL không có `?consumer` | mở `/observatory` | hiện consumer đầu tiên; URL **không** ghi | no |
| `SCN-OBS-01-02` | `AC-OBS-01-02` | failure | `?consumer` không tồn tại | mở trang | `OBS_CONSUMER_UNKNOWN`; không nạp consumer khác | no |
| `SCN-OBS-01-03` | `AC-OBS-01-03` | happy | 500 observation · 3 trace · 7 prompt · 2 `FAIL` · 1 `BLOCKED` | tải trang | 5 KPI đúng; nhãn `Requests` nêu nguồn | no |
| `SCN-OBS-01-04` | `AC-OBS-01-03` | edge | 0 observation | tải trang | 5 KPI = 0 **kèm** trạng thái rỗng | no |
| `SCN-OBS-01-05` | `AC-OBS-01-03` | failure | endpoint observation lỗi 500 | tải trang | `OBS_UPSTREAM_FAILED`; **không** hiện 0 | no |
| `SCN-OBS-01-06` | `AC-OBS-01-04` | happy | flow default 3 worker + 1 draft | tải trang | graph chỉ 3 node default; 2 view cùng dữ liệu | no |
| `SCN-OBS-01-07` | `AC-OBS-01-04` | edge | chưa có flow published | tải trang | `OBS_FLOW_MISSING`; khối khác vẫn tải | no |
| `SCN-OBS-01-08` | `AC-OBS-01-05` | happy | trace `T1` 4 event | nhập `T1` + play | phát 4 event, tự dừng | no |
| `SCN-OBS-01-09` | `AC-OBS-01-05` | edge | trace `T2` chứa chuỗi `deploy` | nhập `deploy` | khớp `T2` | no |
| `SCN-OBS-01-10` | `AC-OBS-01-05` | failure | không trace khớp | nhập `zzz` | `OBS_TRACE_NOT_MATCHED` | no |
| `SCN-OBS-01-11` | `AC-OBS-01-05` | failure | ô nhập rỗng | submit | `OBS_QUERY_EMPTY` | no |
| `SCN-OBS-01-12` | `AC-OBS-01-06` | happy | 120 request · 3 host · 40 prompt con | lọc host + `Failures only` + trang 2 + expand | đúng tập lọc; trang 2 = 51–100; prompt con hiện | no |
| `SCN-OBS-01-13` | `AC-OBS-01-06` | edge | 0 dòng khớp bộ lọc | lọc | `No requests found`; pager disable | no |
| `SCN-OBS-01-14` | `AC-OBS-01-07` | failure | API trả 500 | tải trang | `OBS_UPSTREAM_FAILED` + message | no |
| `SCN-OBS-01-15` | `AC-OBS-01-07` | rbac | phiên hết hạn (401) | tải trang | `OBS_DENIED` | no |
| `SCN-OBS-01-16` | `AC-OBS-01-07` | rbac | consumer bị từ chối (403) | tải trang | `OBS_DENIED` | no |
| `SCN-OBS-01-17` | `AC-OBS-01-08` | happy | trang đã tải | tương tác toàn bộ | 0 request ghi trong network log | manual + log |

## 2. `OUT` — có lý do

| type | Lý do |
|---|---|
| `tenant` | `OUT`: baseline **chưa có multi-tenant** (P2 = Expansion); `F-42` chỉ đọc log của một consumer, cô lập theo schema. Khi P2 mở phải bổ sung trước |
