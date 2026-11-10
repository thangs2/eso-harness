---
sot_doc_version: "0.1.0"
source_of_truth: "sdlc/06.analysis/02.ac/AC-39.md"
status: DRAFT
phase: 1
id: SCN-39
type: scenario-matrix
---

# SCN-39 — Scenario matrix cho `AC-39` (Onboarding UI)

| SCN | AC | Loại | Given | When | Then | Tự động? | Status |
|---|---|---|---|---|---|---|---|
| `SCN-39-1` | `AC-39-1` | happy | có consumer ready | chọn consumer | preview schema/material; không host field | yes | `planned` |
| `SCN-39-2` | `AC-39-2` | edge | danh sách rỗng | mở onboarding | CTA/blocked; không tạo trùng | yes | `planned` |
| `SCN-39-3` | `AC-39-3` | failure | BE provision lỗi | submit | hiện mã/message; không báo xong | yes | `planned` |
| `SCN-39-RBAC-OUT` | — | rbac | — | — | — | — | `OUT` — chưa có account DB (D-111) |
| `SCN-39-TENANT-OUT` | — | tenant | — | — | — | — | `OUT` — consumer không phải tenant (`BR-14`) |

## Luật

- `SCN` **1:1** với `AC`; viết trước code, chạy sau `tdd-impl`.
