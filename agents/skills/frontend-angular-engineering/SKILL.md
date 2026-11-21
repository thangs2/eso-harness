---
name: frontend-angular-engineering
description: ESO Angular 22 engineering standard — standalone, OnPush, signals, typed forms, routing, CSS architecture, API client usage, and build/typecheck gates. Use when adding/changing Angular code in eso/ui.
---

# frontend-angular-engineering

## 1. Component

- Standalone component; `ChangeDetectionStrategy.OnPush`.
- State bằng `signal/computed`; input mới dùng `input()` signal, không `@Input` + `computed` (computed không track plain input).
- Không logic nặng trong template; đưa sang computed/method nhỏ.
- Không `any`; strict template.

## 2. Forms

- Form mới dùng typed reactive forms.
- `ngModel` chỉ cho form tối giản/legacy.
- Validation hiển thị cạnh control; error không đổi layout.

## 3. Routing + data

- Route lazy; auth guard; interceptor gắn Authorization.
- Dùng API client tập trung; không `fetch` rải rác.
- URL state (consumer, trace, tab) phải sync qua query params.

## 4. CSS architecture

- Component-scoped CSS; global chỉ tokens/reset/utility.
- Không patch chồng bằng selector `!important`/`::ng-deep` trừ Material overlay.
- Không copy style giữa page; dùng token + class contract.
- Xoá CSS chết khi refactor.

## 5. Verify

```bash
cd eso/ui
bun run typecheck
bun run build:ng
bun test test/
```

Build fail hoặc typecheck fail ⇒ CRITICAL.

Angular code quality = 15 điểm trong rubric tổng.
