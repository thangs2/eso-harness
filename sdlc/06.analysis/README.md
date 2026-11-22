# `06.analysis` — Phân tích: US · AC · SCN

**Điều này có nghĩa gì:** biến `REQ` (SRS) thành **user story** và **tiêu chí nghiệm thu kiểm được**, rồi thành
**scenario**. Đây là nơi `WBS` lấy `AC` để giao slice, và `BIP/FIP` lấy `AC` để viết packet.

## 1. Cấu trúc

| Folder | Giữ gì | Trạng thái |
|---|---|---|
| [`01.us/`](01.us/00.index.md) | **US** — mỗi `REQ` có **≥1** US (1 `REQ` → n `US`) | ✅ baseline 16 · capability 25 |
| [`02.ac/`](02.ac/00.index.md) | **AC** — mỗi `US` có **≥1** AC (1 `US` → n `AC`), bảng 8 cột | ✅ baseline 16 · capability 25 |
| [`03.scn/`](03.scn/00.index.md) | `SCN` — mỗi `AC` có **≥1** SCN (1 `AC` → n `SCN`), status `planned` | ✅ 41 file |
| [`04.rtm/`](04.rtm/00.index.md) | **ma trận truy vết (RTM)** — mỗi `AC` → `SCN` → endpoint → bảng → test | ✅ `/observatory` |

## 2. Chuỗi

```text
REQ (SRS) → US (01.us) → AC (02.ac) → SCN (03.scn) → WBS slice → BIP/FIP packet → code
```

**Luật:**

1. Cardinality: **1 `REQ` → n `US`** · **1 `US` → n `AC`** · **1 `AC` → n `SCN`**. Mỗi `US` trace **đúng 1 `REQ`**, mỗi `AC` **đúng 1 `US`**, mỗi `SCN` **đúng 1 `AC`**. Id ổn định, không tái dùng.
2. AC phải **kiểm được** (có test/đường kiểm) và **một US không mượn AC của US khác**.
3. AC có **"không kiểm gì"** — nếu không viết được, AC đang giả vờ đầy đủ.
4. `SCN` viết **trước** code, **chạy sau** impl; packet `READY` chỉ cần SCN **đã khai** (`D-81`).
5. Không nhắc công nghệ trong US/AC (đó là FRD/technical).
