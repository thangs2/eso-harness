# `06.analysis` — Phân tích: US · AC · SCN

**Điều này có nghĩa gì:** biến `REQ` (SRS) thành **user story** và **tiêu chí nghiệm thu kiểm được**, rồi thành
**scenario**. Đây là nơi `WBS` lấy `AC` để giao slice, và `BIP/FIP` lấy `AC` để viết packet.

## 1. Cấu trúc

| Folder | Giữ gì | Trạng thái |
|---|---|---|
| [`01.us/`](01.us/00.index.md) | **35 US** — một US cho mỗi `REQ` | ✅ GĐ1 16 · GĐ2 19 |
| [`02.ac/`](02.ac/00.index.md) | **AC** — mỗi US một file, bảng 8 cột | ✅ GĐ1 16 · GĐ2 19 |
| [`03.scn/`](03.scn/00.index.md) | `SCN` — scenario 1:1 với `AC`, status `planned` | ✅ 35 file |

## 2. Chuỗi

```text
REQ (SRS) → US (01.us) → AC (02.ac) → SCN (03.scn) → WBS slice → BIP/FIP packet → code
```

**Luật:**

1. Mỗi `US` trace **đúng 1 `REQ`**; mỗi `AC` trace **đúng 1 `US`**; id ổn định, không tái dùng.
2. AC phải **kiểm được** (có test/đường kiểm) và **một US không mượn AC của US khác**.
3. AC có **"không kiểm gì"** — nếu không viết được, AC đang giả vờ đầy đủ.
4. `SCN` viết **trước** code, **chạy sau** impl; packet `READY` chỉ cần SCN **đã khai** (`D-81`).
5. Không nhắc công nghệ trong US/AC (đó là FRD/technical).
