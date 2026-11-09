---
name: frontend-angular-golden-standard
description: Golden standard for the ESO Angular UI (eso/ui) — design tokens, app shell layout, component inventory, accessibility, Angular 22 quality, and a 100-point review rubric. Use whenever a task touches eso/ui/**, a UI page/component, styles, or a visual review. Produces a score; PASS only at >=85 with 0 CRITICAL.
---

# frontend-angular-golden-standard

**Dùng khi** sửa `eso/ui/**`, thêm page/component, đổi layout/style, hoặc review giao diện.
**Không dùng** cho backend/API; UI chỉ tiêu thụ contract.

**Luật nền:** `AGENTS.md` > rule > skill. Khi UI conflict với `AC-15-*`/plane C, **AC/plane thắng code** — báo BA/TECH, không tự đổi contract.

## 1. Design tokens — không hardcode px

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  --text-xs: 12px; --text-sm: 14px; --text-md: 16px;
  --text-lg: 20px; --text-xl: 24px; --text-2xl: 32px;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
  --container: 1280px;
}
```

Mọi `margin/padding/gap/font-size/radius` mới phải dùng token. Hardcode px chỉ cho border 1px, breakpoint, hoặc giá trị vật lý có comment.

## 2. App shell chuẩn

```text
Header 64px: brand · primary nav · account menu (user, Logout)
Sidebar 240–280px khi có >5 mục; collapse < 960px
Content: max-width 1280px; gutter 24px (mobile 16px); page stack space-5
Page header: eyebrow 12px · h1 24px · subtitle 14px; action bên phải
```

- Shell chịu trách nhiệm: header, nav, account/logout, router-outlet.
- **Logout bắt buộc**: xoá credential (sessionStorage) + điều hướng `/login`.
- Không render nav/header khi chưa đăng nhập; login route độc lập.
- Mobile: ẩn label, giữ icon/text ngắn; nav không tràn ngang.

## 3. Component inventory + states

Dùng **Angular Material + CDK** (hoặc PrimeNG/Spartan nếu có decision khác); không tự viết lại control cơ bản.

| Component | Bắt buộc có |
|---|---|
| Button | primary/secondary/ghost/danger · sm/md · loading/disabled |
| Input/Select/Textarea | label · help · error · required · focus ring |
| Card/Panel | header · body · footer; padding space-5 |
| Table | header sticky · empty/loading/error · row hover · responsive scroll |
| Badge/Pill | success/warn/danger/neutral |
| Dialog/Toast | focus trap · Esc · aria-live |
| Menu | keyboard · click outside · aria-expanded |

Mỗi component có default/hover/focus-visible/disabled/loading/error; không dùng `outline: none` mà không thay thế.

## 4. Angular 22 quality

- Standalone component, `ChangeDetectionStrategy.OnPush`, signals cho state.
- Typed reactive forms cho form mới; `ngModel` chỉ khi form tối giản/legacy.
- Component-scoped CSS; global chỉ tokens/reset/utility.
- Route lazy; guard auth; interceptor gắn Authorization; không gọi `fetch` rải rác nếu đã có api client.
- Không logic nặng trong template; dùng computed/signal.
- Không `any`; strict template; build `bun run build:ng` + `tsc --noEmit` xanh.

## 5. Accessibility + visual

- Contrast AA (4.5:1 text), focus-visible rõ, tab order hợp lý.
- `aria-label` cho icon-only; `role`/`aria-*` cho menu/dialog/table.
- Test 360 / 768 / 1280 px; loading/empty/error/disabled; no horizontal scroll.
- Lighthouse a11y ≥ 95; axe 0 serious/critical.

## 6. Review rubric — 100, PASS ≥85, 0 CRITICAL

| Mục | Điểm |
|---|---:|
| Layout/grid/responsive | 25 |
| Spacing/typography/tokens | 20 |
| Component consistency + Material | 20 |
| Accessibility | 15 |
| States (loading/empty/error/disabled) | 10 |
| Angular code quality | 10 |

CRITICAL (auto-fail): thiếu logout/auth guard; tràn ngang ở 360px; contrast <4.5; control không keyboard; hardcode secret; build fail.

## 7. Verify

```bash
cd eso/ui
bun run typecheck
bun run build:ng
bun test test/*.mjs        # nếu có
```

Screenshot 3 breakpoint + login/logout flow; ghi command + kết quả. Không tuyên PASS nếu chưa build.

## 8. Nguồn chuẩn

- Angular style: https://github.com/angular/angular/blob/main/STYLE_GUIDE.md
- Material/CDK: https://github.com/angular/components
- M3: https://m3.material.io
- Tokens: https://github.com/argyleink/open-props
- A11y: https://github.com/dequelabs/axe-core
- Visual: https://github.com/microsoft/playwright · https://storybook.js.org
