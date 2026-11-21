---
name: frontend-angular-golden-standard
description: Entry point for ESO Angular UI (eso/ui) work. Routes to focused skills for layout/spacing, components, visual/accessibility, and Angular engineering; defines the aggregate 100-point release rubric. Load this first whenever a task touches eso/ui/**.
---

# frontend-angular-golden-standard (entry)

**Đây là skill điều hướng, không phải giáo trình.** Nội dung chi tiết đã tách sang skill con để mỗi lần load không kéo cả file nặng.

**Luật nền:** `AGENTS.md` > rule > skill. UI conflict với `AC-15-*`/plane C ⇒ AC/plane thắng code; báo BA/TECH.

## 1. Chọn skill con

| Công việc | Skill |
|---|---|
| Layout, page frame, padding/margin/spacing, grid, responsive, table alignment | `frontend-layout-spacing` |
| Button, input, select, card, table, badge, dialog, menu, states | `frontend-components` |
| Typography, color, contrast, focus, motion, axe/Lighthouse | `frontend-visual-a11y` |
| Angular 22, signals, OnPush, forms, routing, CSS architecture, API client | `frontend-angular-engineering` |

Rules:

1. Load **entry** trước để chọn đúng skill con.
2. Load **chỉ** skill con liên quan; không load cả bộ nếu task chỉ sửa spacing.
3. Task chạm nhiều vùng ⇒ load nhiều skill con, nhưng vẫn giữ scope từng slice.
4. Không tự tạo pattern mới khi skill con đã có contract.

## 2. Bắt buộc trước khi sửa

```text
đọc skill con phù hợp
→ xác định vùng nào padding, vùng nào margin, vùng nào gap
→ dùng token rem, không hardcode px
→ sửa component-scoped CSS, không vá global
→ verify bằng build + DOM measurement
```

## 3. Rubric tổng — 100, PASS ≥85, 0 CRITICAL

| Mục | Điểm | Skill |
|---|---:|---|
| Layout / page frame / spacing / grid / responsive | 25 | `frontend-layout-spacing` |
| Component consistency + Material + states | 20 | `frontend-components` |
| Visual / typography / contrast / focus / motion | 15 | `frontend-visual-a11y` |
| Accessibility (keyboard, aria, axe) | 15 | `frontend-visual-a11y` |
| Angular code quality | 15 | `frontend-angular-engineering` |
| Loading / empty / error / disabled states | 10 | `frontend-components` |

**CRITICAL auto-fail:** thiếu auth/logout; tràn ngang 360px; contrast <4.5; control không keyboard; hardcode secret; build fail.

## 4. Verify

```bash
cd eso/ui
bun run typecheck
bun run build:ng
bun test test/
```

Screenshot 360 / 768 / 1440. Đo DOM cho spacing/layout, không duyệt bằng mắt.

## 5. Nguồn chuẩn

- Angular style guide: https://github.com/angular/angular/blob/main/STYLE_GUIDE.md
- Angular Material / CDK: https://github.com/angular/components
- Material 3: https://m3.material.io
- Tokens: https://github.com/argyleink/open-props
- A11y: https://github.com/dequelabs/axe-core
- ESO tokens: `eso/ui/src/styles.css`
