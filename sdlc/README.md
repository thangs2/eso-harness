# SDLC — eso-harness

**`sdlc/` là nơi duy nhất giữ tài liệu bền của sản phẩm.** Người và agent đọc và ghi ở đây.

> **Trạng thái repo (2026-11-09):** repo này **không còn** ba thư mục của bố cục cũ — chúng đã bị xoá theo `D-108`
> (docs mô tả code cũ, profiles cấu hình cũ, packages mã v1). Mã v2 nằm trong [`eso/`](../eso); agent config nằm trong
> [`agents/`](../agents). Bất kỳ câu nào còn nhắc tới ba thư mục đó chỉ là **lịch sử** (decision log trước `D-108`),
> **không** phải đường dẫn sống.

## Sản phẩm

`eso-harness` — harness chứng minh được: biến *"agent nói nó ổn"* thành khẳng định kiểm chứng được, cho từng **consumer**
(một repo/đội) do operator đăng ký. Định hướng ở [`03.inception/01.vision`](03.inception/01.vision/01.vision-mission-goals.md).

Consumer (`x79`, `atrievefin`, `fineso`, `baplatform`) là **nơi thụ hưởng**, không phải đối tượng ta đang xây. Việc của
consumer thuộc SDLC của chính consumer đó.

## Cấu trúc

**Folder** đánh số `01…` **chỉ trong folder**; **file** đánh số `01…` **chỉ trong file**
([naming law](02.governance/01.standard/01.artifacts.md) §4.1). Ở cấp `sdlc/` chỉ có folder, nên đây là **một** dãy — liền
mạch, **không trùng số**, và **không mang nghĩa "stage"**.

> **Luật nằm trong `sdlc/`.** Chuẩn SDLC (kind · cổng · BIP/FIP · workflow · các phép kiểm) sống ở
> [`02.governance/01.standard/`](02.governance/01.standard/00.index.md) — cùng cây với các artifact nó mô tả, vì `sdlc/`
> **không** được ship, **không** được provision, **không** có bản sao ở consumer.

```text
01.agent-manifests   meta — vùng AI: spec domain + capability (≤150 dòng · ≤4 000 ký tự)
02.governance        meta — luật (standard) · bản ghi (records) · chính sách agent (policies) · sơ đồ (diagrams)
03.inception         vì sao tồn tại · pain point · vision · quyết định
04.landscape         bối cảnh: đứng ở đâu, ai cho gì, chỗ không chơi
05.requirements      phải LÀM được gì (BRD · PRD · FRD · SRS · NFR)
06.analysis          actor · use case · US · AC · scenario
07.technical         kỹ thuật, một cửa — architecture → data-design → api
08.ui-design         thiết kế giao diện (Figma · Penpot · guideline)
09.wbs               WBS — Feature → Epic → Story → Task · Jira bridge · packets
10.test              phép thử nói "done" nghĩa là gì
11.delivery          demo/release theo đợt · script stable · bằng chứng bàn giao
```

**Vì sao `07.technical` là một nhóm, không phải ba folder:** C4 → data → API là **một chuỗi lập luận** — container tồn tại, nó lưu
một dòng, nó nhận dữ liệu qua một endpoint. Ba folder rời buộc người đọc **đoán** folder nào sở hữu câu hỏi, mà đáp án thường là
**cả ba**.

**Vì sao `08.ui-design` ngoài nhóm đó:** UI theo **chuẩn thiết kế riêng** và **không** trả lời "các phần gọi nhau thế nào".
Gộp UI vào technical là trộn **hợp đồng** với **trình bày**.

**`stage` không phải số folder.** Stage sống trong frontmatter `phase` của từng tài liệu. Folder là **thứ tự đọc**; stage là
**thuộc tính của tài liệu** — nên `06.analysis` vẫn khai `phase: 2`.

### API ≠ UI — hai tài liệu, hai người đọc

| | Ở đâu | Trả lời |
|---|---|---|
| **API spec** | `07.technical/03.api/` | máy gọi nhau thế nào: endpoint · payload · mã lỗi · idempotency |
| **UI/UX design** | `08.ui-design/` | người nhìn thấy gì: bề mặt · màn hình · luồng |

Gộp hai thứ này vào một folder là trộn **hợp đồng** với **trình bày**.

### Không tạo folder rỗng

Thêm folder mới **khi có nội dung thật**; hiện tại cây dừng ở `11.delivery`.

## Luật đọc/ghi tài liệu

1. Pain point + vision là **nguồn** ([`03.inception`](03.inception/00.problem/00.index.md)); mọi tầng dưới phải trace được về chúng.
2. Số liệu phải kèm **ngày + nguồn**; không dùng số của cây khác làm số hiện hành.
3. Quyết định chỉ tồn tại trong [`decision log`](03.inception/02.decision-log/00.index.md) — miệng nói không tính.
4. Không cite file không tồn tại (phép kiểm `X28` của chuẩn).
