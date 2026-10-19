# Satori V2 — Design Plan (Precision Product)

> Status: plan. Visual reskin of `apps/web` — no behavior changes.
> Direction: **precision product**. Looks are a side thing: standard modern product, high craft. No gimmicks, no signature stunt. Effort goes to data legibility, live states, and both themes.
> Decisions (2026-10): precision product vibe · light/dark first-class · typography: **Inter + JetBrains Mono** (Geist rejected) · personality not forced.
> Target surfaces: cockpit, statement, results, ranking, manage (per `docs/FRONTEND_SPEC.md`).

---

## 0. Principles

1. Standard over unique. Familiar patterns, executed cleanly.
2. Semantic tokens only. Zero per-page hex values.
3. Data legibility first: tabular numbers, dense tables, verdict text always visible (never color-only).
4. Both themes first-class: 1:1 token parity, tested per surface.
5. Motion only on state change, ≤200ms, killed by `prefers-reduced-motion`.
6. Stays as-is: component API (`VerdictCell`, `Table`, `Tabs`, `Modal`…), `STR` i18n, keyboard map, verdict hues. Pure reskin + consistency cleanup.

---

## 1. Tokens (`app/tokens.css`)

### 1.1 Color

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F8FA` | `#0B0D12` | page background |
| `--surface` | `#FFFFFF` | `#11141A` | cards, tables, bars |
| `--border` | `#E4E7EC` | `#232833` | hairlines, outlines |
| `--fg` | `#0F1728` | `#E9EDF4` | primary text |
| `--muted` | `#5B6475` | `#8A93A6` | secondary text, labels |
| `--accent` | `#3B5BFF` | `#7C93FF` | links, focus, selection, live, primary buttons |
| `--accent-soft` | accent @ 12% | accent @ 18% | selection, hover fills |
| `--accent-fg` | `#FFFFFF` | `#0B0D12` | text on accent |

Status palette = separate namespace. Never reused as brand/accent.

| Status | Light | Dark | Verdicts |
|---|---|---|---|
| `--ok` | `#16A34A` | `#4ADE80` | OK, ANS |
| `--wa` | `#DC2626` | `#F87171` | WA |
| `--tle` | `#D97706` | `#FBBF24` | TLE |
| `--mle` | `#9333EA` | `#C084FC` | MLE |
| `--re` | `#DB2777` | `#F472B6` | RE |
| `--ce` | `#64748B` | `#94A3B8` | CE |
| live | `--accent` | `--accent` | QUE, CMP, TST |

Chip recipe: `bg color @ 12%` + `1px border color @ 35%` + text `color` (AA-checked). Always carries text label (`OK`, `2 (1:41)`, `QUE`).

### 1.2 Type

```
--font-sans: "Inter", system-ui, -apple-system, sans-serif
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace
```

Load via `next/font/google` in `app/layout.js` (replaces Google Fonts `<link>` tags).

Scale (sans unless noted): 12 / 13 / 14 (body) / 16 (statement body) / 20 (h2) / 24 (h1) / 32 (display).
Weights: 400 body · 500 labels, table heads · 600 headings · 700 display + verdict codes.
`font-feature-settings: 'tnum'` on all tables, times, scores, countdowns.
Mono used only for: source code, IDs, limits, verdict codes, queue/progress (`t 7/12 · 0:14`).

### 1.3 Space, radius, shadow

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48. Page gutter `16px` mobile, `24px` desktop.
- Radius: `--radius 8px` (cards, buttons, inputs) · `--radius-sm 6px` (chips, badges).
- Shadow: light `0 1px 2px rgb(15 23 40 / 0.05)`, cards + popovers only. Dark: no shadow, borders only.
- Density: table rows `40px`, control height `32px` (compact) / `40px` (default), touch targets ≥44px on mobile.

---

## 2. Layout

- **Top bar** (sticky, `backdrop-blur`, `--surface @ 85%`): logo → `/`; contest switcher; global search; notifications; profile; `PL/EN`; theme toggle. Server time + queue/ETA as small mono readout (right). Mobile: logo + contest + overflow.
- **Context sidebar** (contest pages, `lg+`): News / Problems / Ranking / Clarifications / Grade (+ Manage for admins). Collapses to tab strip below `lg`.
- **Content**: `max-w-7xl mx-auto`. Cards `--surface` + `1px --border` + `rounded-lg` + shadow (light only).
- **Tables** (hero surface): `--surface` card, sticky header, sticky first 1–2 cols on overflow, 40px rows, hover `--accent-soft`, sortable heads, horizontal scroll container with `overscroll-behavior-x: contain`. Mobile: horizontal scroll → card list only for small non-tabular content.
- **Forms**: label 13/500 above, hint + inline error slots under, error text `--wa` + icon (never color-only).

---

## 3. Verdicts + live states

- Keep current hues (they work); normalize recipe to §1.1 chip: tint bg + border + text, always text label.
- Live (QUE/CMP/TST): pulsing dot (6px, `--accent`) + mono progress `t 7/12 · 0:14`. Pulse = only ambient animation in the product.
- SSE update lands → row flash `--accent-soft` 600ms → settle. Verdict paint <2s after judged event.
- Queue/ETA always visible (top bar readout + `StatusBanner`); never silent.

---

## 4. Motion

- ≤200ms, `ease-out`, state changes only (hover, menu, modal, row flash, verdict swap).
- Skeletons: static shimmer on `--border`. Empty + error states everywhere (message + action + retry).
- `prefers-reduced-motion: reduce` → all animation/transition off (existing rule in `globals.css` kept).

---

## 5. Accessibility + both themes

- Contrast AA per surface (text ≥4.5:1, UI borders/icons ≥3:1), checked in **both** themes per token pair.
- `focus-visible`: 2px `--accent` ring, 2px offset. Tab order = visual order. `Esc` closes modal/drawer/palette.
- Keyboard map unchanged: `/ j k o s h`, `Ctrl+Enter`, `Esc`, `⌘K`.
- Responsive: 375px / 768px / 1024px / 1440px. No horizontal page scroll except table containers.
- SVG icons only (Phosphor/Lucide), `aria-hidden` beside visible text, standalone icons get accessible names.

---

## 6. Rollout

| Phase | Scope | Gate | Status |
|---|---|---|---|
| **D0** tokens + fonts + shell + reskin buttons/chips/tables | `tokens.css`, `globals.css`, `layout.js`, `tailwind.config.js`, `ui/Button`, `ui/Badge`, `ui/Table`, `VerdictCell` | before/after screenshots, both themes | done 2026-10-01 |
| **D1** primitives polish | `ui/Input`, `ui/Modal`, `ui/Drawer`, `ui/Toast`, `ui/Tabs`, skeleton, empty, error | states complete, focus trap ok | done 2026-10-01 |
| **D2** student core | cockpit, statement, results + detail, ranking | density + live states, mobile submit ≤3 taps | done 2026-10-01 (2 taps) |
| **D3** teacher surfaces + print | manage, grade console, integrity, webhooks, print stylesheet | walkthrough clean, print snapshot ok | done 2026-10-01 (walkthrough clean; print CSS code-verified, no print-media emulation available) |
| **D4** QA gate | both themes, contrast, focus, reduced motion, 375px | Lighthouse ≥90 on `/contests` | done 2026-10-01 except Lighthouse (deferred — needs prod build, run `next build && next start` + Lighthouse later) |

Implementation order inside D0: `tokens.css` → `globals.css` (kill hardcoded hex in `.verdict-*`, `.vcell-*`, `.edge-blue`) → `layout.js` (fonts) → primitives → screenshots.

## 7. Out of scope

Behavior, API, routing, i18n key set, keyboard map. New components beyond existing primitives. Re-theming of verdict hues.
