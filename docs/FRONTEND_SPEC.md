# Satori V2 — Frontend Spec (hyper-detailed, every page)

> Status: spec. Implements `SATORI_V2_PROPOSAL.md` M1+B+B2+M4+M5+M8+M9 for web.
> Current truth: 28 source files under `apps/web`, zero styling infra (no `tailwind.config`, no `globals.css`, no dep — classes render unstyled), one shared client (`lib/client.js`: `api/API/VERDICT_CLASS/STR`), hooks (`useApi/useSSE/token helpers`), cockpit + ranking + clarifications-read + manage/grade/integrity v1 exist.
> API base: `http://localhost:3001` (`NEXT_PUBLIC_API` override, `/api/:path*` rewrite in `next.config.js`).
> How to read: §0 foundation first, then §1 shell, §2 student pages, §3 teacher pages, §4 cross-cutting, §5 build phases.
> Per-page template: route · purpose · layout · states · interactions · API/events · a11y/i18n · acceptance.

---

## 0. Foundation (fix "looks like demo" first)

### 0.1 Styling stack (missing today — install before any page polish)
- `npm i -D tailwindcss postcss autoprefixer`, add `tailwind.config.js` (`content: ./app/** ./components/**`, `darkMode: 'class'`), `postcss.config.js`, `app/globals.css` (`@tailwind base/components/utilities` + tokens import), import in `layout.js`.
- Tokens file `app/tokens.css`: CSS vars `--bg --fg --muted --border --accent --accent-fg --warn --danger --radius --shadow`. Light + `.dark` overrides.
- Type scale: display 30/36 bold · h1 24 bold · h2 18 semibold · body 14 · small 12 · mono 12 for code/limits/flags.
- Spacing: page `max-w-6xl mx-auto p-4`, cards `border rounded p-3`, rows `py-2`, gaps `2`.
- Verdict colors (keep hues, fix contrast): `OK bg-green-600 white` · `ANS bg-green-200 black` · `WA bg-red-600 white` · `TLE bg-orange-500 black` · `MLE bg-purple-600 white` · `RE bg-pink-600 white` · `CE bg-zinc-500 white` · `QUE/CMP/TST pulse blue`. Never color-only: pill always carries text (`OK`, `2 (1:41)`, `QUE`).
- Focus: visible ring on all interactive (`focus-visible:ring`), tab order = visual order, `Esc` closes every modal/palette.

### 0.2 Primitives (build once, reuse everywhere)
- `Button` (primary green / secondary border / danger), `Input/Select/Textarea` (label + hint + error slots), `Badge/Pill`, `Card`, `Table` (sticky header prop, sticky first-2-cols prop, sortable header), `Tabs`, `Modal` (focus trap, `Esc`, `Ctrl+Enter` submit variant), `Drawer` (row-expand), `Toast` (SSE events, sound toggle persisted), `Skeleton` (list shimmer), `EmptyState` (icon + line + action), `Tooltip`, `Countdown` (server-time based), `CopyButton`, `DiffView` (expected vs got, whitespace toggle), `CodeBlock` (highlight + theme choice + line numbers).
- `STR` dict grows to full key list (§4.3). `lang="pl"` default, toggle persists (`localStorage satori-lang`), instant switch, no mixed-language screen.

### 0.3 Time + status honesty (no silent states)
- Header shows server time (from `/api/health.time`, 1s tick) + local time on hover. Contest pages add countdown to start/end/freeze.
- `StatusBanner` everywhere below header: hidden when queue 0; else `Judge queue: N, ETA ~Xs · worker`. Poll 20s. `/status` full page (queue, workers, images `kolejka/satori:judge`).
- Every async view: skeleton → content | empty (with action) | error (message + retry + report-id style hint). No blank screens.

---

## 1. Shell, navigation, command palette

### 1.1 `app/layout.js` (root)
- Header: logo → `/`; `Select contest` → `/contests`; `Search`; `Languages`; `Status`; `Results`; `Profile`; `Cmd+K` hint (desktop); server-time; `PL/EN`; dark toggle. Mobile: logo + contest + overflow menu.
- Mounts `StatusBanner`, `CmdK`, toast root. `main max-w-6xl`.
- Error boundary per subtree; 404 page with links (home, contests, search).

### 1.2 `components/CmdK.js` (exists, polish)
- Opens `Ctrl/⌘+K`, closes `Esc`. Searches contests (`GET /api/contests?q=`) + problem jump (recent contest problems) + actions (go ranking, new submit, toggle theme).
- Recent contest persisted (`satori-recent`), auto-redirect after login.
- Acceptance: open <100ms, list filters locally.

### 1.3 `components/StatusBanner.js` (exists, keep)
- `GET /api/status` now + 20s poll. Queue 0 → render null.

---

## 2. Student side

### 2.1 `/` home
- Purpose: landing + resume. Sections: hero (one line + CTA Select contest), `Continue` (recent contest card), `My contests` (`GET /api/contests?role=joined`, empty → browse button), `Platform status` mini (queue/ETA).
- States: logged-out → hero + login/register CTAs; logged-in → continue + mine.

### 2.2 `/contests` browser
- Tabs `Joined / Pending / Other` (`?role=`), `Show archived No/Yes` persisted, search `?q=` (debounced, local filter <100ms), sort Name/Description.
- Row: name (link), description, mode badge (`ICPC/IOI/LABS/EXAM/PLAYGROUND/VIRTUAL`), lifecycle badge, member count, `Apply` button with states (Apply → Pending → Joined). Archived grayed.
- Acceptance: archived filter persists reload; apply never silent (toast result).

### 2.3 `/contests/[id]` contest home (restructure: tabs News | Problems | Ranking | Clarifications | Grade)
- Header: name, mode+lifecycle badges, countdown (start/end/freeze), server+local time.
- News tab: `GET .../news` markdown list, scheduled posts hidden until due, attachments with previews.
- Subpages: `GET .../subpages` rendered MD + `content_files` links.
- Problems tab = cockpit (§2.4). Ranking tab embeds §2.7. Clarifications tab embeds §2.8. Grade tab (course mode) embeds §2.9-student.
- Manage link visible only when `members` fetch succeeds (admin).

### 2.4 `/contests/[id]` problems cockpit (flagship, exists `ProblemCockpit.js` — upgrade)
- Toolbar: search `/`-focused (code+name, <100ms over 500 rows), filters `status[all|solved|tried|todo] + difficulty + tag + setter + ProblemSet group` (shareable `?f=`), sort (code, name, solves%, difficulty, my-score), saved views (`UZI warmup`, `Labs 3 todo`), `Hide solved` persisted, skeleton shimmer while loading, virtualized rows.
- Row: code (alias-letter resolved), name link → problem page, `PDF/HTML` badge, difficulty + tags, solved-by-% bar, `★` favourite persisted, verdict pill (`best` + score IOI/course + tries), `+ Submit` button.
- Expand drawer (click pill): last 3 submits (time, lang, verdict, `view diff` → `/results/:id`, `re-submit`), `Full history` → `/results?problem=`.
- Submit modal: paste/file/drag-drop, filename field with inline charset check + suggestion (never silent 2013 rule), language auto-detect + override, size guard 512KB, `sample-run` toggle wired (currently ignored — fix: pass through), `Ctrl+Enter` submits.
- Live: SSE per submit pushes `testing 4/12 → OK` into row (animate pill), toast + optional sound/desktop notify, auto row reload. Acceptance: verdict visible <2s after judged event.
- Keyboard: `/` search, `j/k` move, `o` open, `s` submit modal, `h` hide row.
- Notes: per-problem private + per-team note (GET/POST `/api/notes`), export.
- Recommendations: `next unsolved closest to your rating` + `upsolve queue` from failed submits.
- Sidebar (desktop): mini-rank (`you #7, +1 solve to #5`), sparkline solves-over-time, progress `solved X/Y, points Z, streak`.

### 2.5 `/contests/[id]/problems/[pid]` statement (exists — deepen)
- Header: code + name, visibility badge, `watch` toggle (rejudge/limit/editorial notify).
- Limits card (always visible): `1.0s (×2 Python) / 256MB / stack 64MB` + matrix link + per-lang multipliers + limit-change history note (fixes "had OK now TLE").
- Tabs: Statement MD+LaTeX | PDF (dual view, print-friendly, dark code) | Editorial (locked until solved, link slot).
- Samples: one-click copy, `Run samples` in-modal (sample-run, no penalty), WA diff viewer (expected vs got, whitespace visualize).
- Sticky submit panel (mobile ≤3 taps: code → filename → submit), `Ctrl+Enter`, PL/EN per-problem switch.
- Related: same-set prev/next, recommendations.

### 2.6 `/results` + `/results/[id]` (exist — complete)
- List filters: contest, problem, verdict, me/team, `limit` (default 50/max 200, persisted), stable deep links.
- Grouped best-first + timeline views; compare any two submits side-by-side; `Download my codes ZIP` (client zips visible codes).
- Detail: header `#id status lang file cpu/mem`, SSE live timeline `queued → compiling → testing t3/12 → judged`, per-test table (jury visibility: all / first-failed / none; students see allowed slice), compile log with line numbers, explainer cards: TLE (`used/limit` + O(n log n)/fast-I/O recipe), MLE (`used/limit` + shrink/stream recipe), CE (first error + headers/flags hint) + docs link; code view highlight + theme + permalink + `Re-submit` + `Download`.

### 2.7 `/contests/[id]/ranking` (exists — upgrade)
- Mode tabs ICPC/IOI/course (API `?mode=`). Sortable columns, name filter, sticky header + first two cols, scroll container `max-h-70vh`.
- Live dot + SSE refresh, freeze countdown + frozen curtain + replay scrubber after unfreeze.
- Cells: V1 format `-` / `N` / `N (H:MM)`; penalty tooltip (`2 wrong → +40 min`, 20min each); local TZ on hover; team rows expandable to members.
- Export CSV + print stylesheet; clarifications ticker beside board during contest.

### 2.8 `/contests/[id]/clarifications` (read-only today — complete)
- Student: ask form (problem select + question), my questions with answer states.
- Jury (admin): answer queue, bulk announce, visibility (all / jury-only leak guard in exam mode).
- Ticker component reused on ranking + cockpit during running contests.

### 2.9 Student grade tab (new UI on existing `GET .../grade` + `grade.ics`)
- Progress bar, per-lab points, best-of-K + late-penalty applied visibly, `what-if` sliders (projection), grade formula preview, deadline calendar + ICS download, `satori-points` logic native.

### 2.10 `/search` (exists, keep) · `/languages` (exists, add hello-world + copy + per-lang time-mult column) · `/status` (exists, add maintenance banner text + worker images)
- Search spans contests/problems/users/announcements, keyboard `/` global.

### 2.11 Auth `/login` `/register` `/me` (exist — polish)
- Login: JWT + refresh stored, device `web`, remember-me, visible expiry, error mapping (bad cred → hint), recent-contest redirect.
- Register: login `3–24 [a-z0-9_]`, email, password+confirm + strength, access-code optional documented, no captcha (rate-limit note).
- Me: 5-field completion meter, affiliation org select (`GET /api/orgs`), save, per-device sessions + revoke-all, team memberships list.

### 2.12 `/notifications` (new page on existing `GET /api/notifications`)
- Inbox: `submit.judged` (verdict pill + link), `rejudge.done`, `limit.changed`, editorial; read/unread, filters, prefs (in-app + e-mail + webhook URL hint), per-problem watch toggles.

### 2.13 Offline PWA (extend `sw.js`)
- Cache statements/samples for train/plane; outbox: submits queued offline → auto-send on reconnect with status; install prompt; `stale-while-revalidate` scoreboards.

---

## 3. Teacher / jury side (all under `/contests/[id]/manage`, admin-gated; non-admin sees 403 + request-access hint)

### 3.1 `/manage` dashboard (exists — expand)
- Contest settings: name/description/mode/template, lifecycle stepper `draft → registration → running → finished → archived` with guards (e.g. can't run without visible problems), registration `open/approval/invite` + auto-approve domain/affiliation regex, schedule start/stop/freeze datetimes, scoreboard mode + penalty.
- Members: pending queue (search, one-click approve/reject, approve-all-by-filter), CSV import (result `added N, unknown: logins`), e-mail templates, roles add (teacher/jury/participant), USOS group sync note.
- Teams: list, create, invites, substitutes, scoreboard-name vs login-identity mapping.
- Danger/productivity: duplicate contest (clone `UZI 2025 → 2026`), bulk extend deadline, ranking snapshot export (protocol paper trail), archive.
- Announcements composer: markdown news + scheduled posts + attachments previews + e-mail/in-app/RSS toggles + forum deep-link.
- Recent audit preview (full log §3.5).

### 3.2 `/manage/problems` list + `/manage/problems/[pid]` authoring = `ProblemEditor` (exists embedded — promote)
- List: all visibilities (`draft/hidden/visible/quarantined`), letter-consistency check warnings, solves% + tries, per-row: edit, rejudge WA-count, quarantine 1-click + reason (replaces silent missing tasks), clone across contests, alias letters per contest, bulk PDF re-export.
- Editor sections: statement MD+LaTeX + preview + PDF import/export + PL/EN tabs + versioning + diff; samples manager (copy/run); tests tree (groups/subtasks, cases add/edit/delete, checker `token|float(tol input)|custom`, validators note `kolejka-judge` format kept); limits (time/mem/stack explicit + per-lang multipliers + history); bulk (ZIP Polygon import, git-push instructions `TFKls/satori-git` dream, Athina PDF bulk); danger (rejudge all, delete with type-to-confirm).

### 3.3 `/manage/grade` course console (exists — expand)
- Formula bar: weights table, best-of-K, late-penalty/day, preview on sample student.
- Matrix: students × labs with points, missing highlighted; at-risk list (no submit in 7d / <50% median); unsolved histogram; per-test fail heatmap; bulk feedback composer (posts comment to selected `WA on A`); code view + inline comments; USOS export (CSV shape BaCa2-compatible) + ICS.

### 3.4 `/manage/integrity` (exists heatmap+audit — complete to M9)
- Similarity: threshold slider (0.6 flag / 0.85 high), pair list with score + side-by-side diff, jury-only banner, student appeal queue + resolve actions.
- Timeline anomaly flags (rapid-after-peer solves).
- Exam settings: fullscreen/paste-block toggles, IP allowlist editor, time-window tokens, problem-order shuffle — enforced client-side with server note.
- Audit log: full filterable table (who changed tests/limits/members/scoreboard + when + diff).

### 3.5 `/manage/webhooks` (new UI on existing `POST /api/webhooks`)
- Register URL + event checkboxes (`submit.judged`, `rejudge.done`, `limit.changed`), recent deliveries table, test ping button.

---

## 4. Cross-cutting checklists

### 4.1 Responsive / mobile
- Breakpoints `sm/md/lg`; tables → horizontal scroll + sticky first col (mobile) → card list (small); submit panel sticky bottom on problem page; ranking `max-h` scroll; CmdK full-width sheet on mobile.
- Budgets: Lighthouse ≥90 (perf/a11y/best-practice/SEO); Playground 500-row filter <100ms client; SSE verdict paint <2s; list skeleton <300ms first paint.

### 4.2 Accessibility
- Contrast AA (verdict pills keep text), focus rings, tab order = visual, `aria-live polite` toasts + judge timeline, tables with `scope` headers + captions, keyboard map documented (`/ j k o s h`, `Ctrl+Enter`, `Esc`, `Cmd+K`), image `alt`, form labels + inline errors, reduced-motion disables pulse animations.

### 4.3 i18n (extend `STR`, PL default)
- Keys: nav, auth, contests, problems, submit, results, ranking, clarifications, grade, manage, integrity, exam, errors (incl. `FILENAME_CHARSET` + suggestion), verdicts, time units, empty states. No mixed-language screen; per-problem PL/EN switch falls back to available statement with badge.

### 4.4 Errors (never silent)
- Filename: `422` → inline message + suggested name + one-click apply. Limits: used-vs-limit cards. Queue: position + ETA always. Exceptions: friendly page + report-id + retry. Archived contest submit → upsolve hint (Playground).

---

## 5. Build phases (frontend-only, API exists)

- **F0 foundation**: Tailwind install + config + tokens + globals; primitives (Button/Input/Badge/Card/Table/Tabs/Modal/Drawer/Toast/Skeleton/Empty/Tooltip/Countdown/Copy/Diff/Code); `STR` full dict; `useApi/useSSE` refresh-on-401; shell (header/nav/CmdK/StatusBanner/404). Gate: Lighthouse ≥90 on `/contests`.
- **F1 student core**: auth trio, contests browser+apply, cockpit upgrade (filters/saved views/keyboard/notes/mini-rank), problem deepening, results + detail, ranking upgrade, clarifications ask, search/languages/status polish, sampleOnly fix. Gate: mobile submit ≤3 taps; 500 rows <100ms; live <2s.
- **F2 teacher**: manage dashboard, problems list + authoring, grade console, integrity M9, announcements, webhooks UI. Gate: teacher walkthrough (create lab → tests → limits → grade → USOS export) click-recorded, zero 403 surprises.
- **F3 delights**: replay scrubber + freeze curtain, recommendations/upsolve queue, compare + ZIP, notifications + watch, PWA offline outbox, exam-mode UI polish, print styles. Gate: PL/EN audit clean; a11y audit clean; protocol print snapshot approved.

## 6. Open questions (need teacher/jury answers, per proposal §E)
1. Freeze length + clarifications visibility in exam mode? 2. Team identity: 1 login vs 3 merged? 3. Verdict detail policy during vs after contest? 4. USOS write-grades or read-groups only + SSO provider? 5. Peak submits/min + retention (archive since 2011?).
