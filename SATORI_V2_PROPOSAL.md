# Satori V2 — Proposal (Modern Rewrite, Same Purpose)

> Purpose stays: ICPC-style contests (UZI) + university courses + open Playground practice.
> Strategy: modern rewrite, API-first, Kolejka-native judge, Polygon-like authoring, LMS-lite for teachers, delightful UX for students.
> Companion: `SATORI_V1_SPEC.md` (what V1 does today).

---

## 0. Design Principles for V2

1. **API-first, scrape-never** — every click = documented REST + WebSocket; official CLI/SDK day one (kill the 4 scraping CLIs by absorbing them).
2. **Contest is still king** — keep `Contest{course|competition|playground}` mental model, but add templates + modes (ICPC, IOI, labs, exam).
3. **Teacher time < student time** — bulk ops, CSV/USOS import, rejudge-one-click, auto-points export.
4. **No silent failures** — filename rules, limits, queue ETA, verdict reasons always visible with fix hints.
5. **Boring tech, fast UI** — Django/DRF or NestJS + Postgres + Redis + S3 + Kolejka workers + Next.js; SSR + responsive + dark mode + PL/EN i18n.
6. **Coexist, then replace** — import V1 contests/problems/submits/rankings; run Kolejka images `kolejka/satori:*` unchanged at first; BaCa2-compatible broker interface.

---

## A. MAJOR Improvements (Epic-level)

### M1. New Web App + Design System
- **Problem**: V1 FAQ itself says *"ugly, slow, inconvenient"*; banner + tables, no mobile, no dark, no i18n.
- **V2**: responsive Next.js (or HTMX+Django if team prefers Python), tokens, accessible tables, sticky scoreboard headers, command-palette (`Cmd+K` → switch contest/problem), full PL/EN toggle, server-time + local-time dual display.
- **Acceptance**: Lighthouse ≥90, mobile submit in ≤3 taps, Playground problem list with 500 tasks filters <100 ms client-side.

### M2. Real API + Official CLI/SDK
- **Spec**: `POST /api/auth/token`, `GET /contests?role=joined`, `GET /contests/{id}/problems`, `POST /submits (multipart|git|paste)`, `GET /submits/{id} (SSE live)`, `GET /rankings/live (WS)`, OpenAPI 3.1 + webhooks (`submit.judged`).
- Absorb best of `dominik-korsa` UX: `satori submit file.cpp` with problem URL in comment, `--open`, `--ci`, `SATORI_TOKEN`; plus `pdf/status/problems/contests/results/details` commands from `mhorod/zielmicha/MasFlam`.
- Token auth (expiring + refresh, per-device revoke), no password-in-CLI, no cookie scraping.
- **Why major**: unblocks IDE plugins, bots, `satori-points`-style analytics, auto-testers.

### M3. Auth, Organizations, Teams
- USOS SSO + university SSO (OIDC), e-mail+password with 2FA/TOTP, `Affiliation` becomes `Organization` object (UJ / AGH / V LO…).
- Roles: `student, team_member, teacher, contest_admin, judge_admin, superadmin`; per-contest `Add teacher / jury / participant (CSV, USOS group sync)`.
- First-class **Teams**: `uj7 {3 members, 1 login OR 3 logins merged to one row}`, separate scoreboard identity vs login identity; team invitations, substitutes.
- Preserve V1 `Access code` as optional invite-code path, but documented.

### M4. Contest Engine Templates
- Templates: `ICPC (UZI)`, `IOI / OI (points per subtask)`, `Course Labs (weekly, best-of-N)`, `Exam (lockdown, no clarifications leak)`, `Playground (open upsolve)`, `Virtual replay`.
- Lifecycle: `draft → registration (open/approval/invite) → running (freeze support) → finished (upsolve) → archived`; scheduled start/stop, `registration auto-approve by domain/affiliation regex`.
- Scoreboard modes: ICPC (solves+penalty), IOI (sum points), course (weighted labs → grade); **freeze last hour + unfreeze replay**, CSV/API export, printable standings.
- Clarifications (jury Q&A) + Announcements (e-mail + in-app + RSS) — replaces `playgroundmail.png` hacks + forum threads.

### M5. Problem Authoring (Polygon-lite)
- Editor: Markdown + LaTeX + PDF import/export, sample I/O with one-click copy/run, statement versioning + diff, translations PL/EN.
- Tests: file/tree editor, groups/subtasks, validators + checkers (float tolerance, token diff, custom judges via `kolejka-judge` — keep thesis format, add UI), per-language time multipliers, memory/stack limits explicit (kill *"by eye"* limits).
- Bulk: git-push problems (`TFKls/satori-git` dream), ZIP (Polygon) import, PDF statement bulk import for Athina legacy.
- Visibility: `draft / hidden / visible / banned-buggy` (FAQ: *"some UZI tasks missing — were buggy, shhh"* → make quarantine explicit).

### M6. Submit Reimagined
- Paste + file + drag-drop + GitHub/gist import + in-browser editor (Monaco) with syntax highlight + `Ctrl+Enter` submit.
- Pre-submit checks: filename charset explained inline (no more silent 2013 rule), language auto-detect + override, size guard, `sample run` (run on samples without penalty) before full judge.
- Queue transparency: position, ETA, worker region; live timeline `queued → compiling → testing t3/12 → judged`; auto-redirect to result + toast + optional sound/desktop notify (extension features → core).
- History: per-problem best status chip, diff vs previous submit, revert-to-re-submit.

### M7. Judge on Kolejka, Observable
- Keep Kolejka (Server/Worker/Observer/Foreman + Docker + cgroups) — don't reinvent. Add: per-submit trace (CPU/mem graphs), compile log expand, per-test verdict table with input/output diff (jury-controlled visibility: `show all / first-failed / none` per contest phase).
- One-click **rejudge** (problem / contest / single test), judge-version pinning, A/B time-limit preview (*"had OK, now TLE"* → show limit change history).
- Languages matrix page (replaces login-walled `/subpage/184196`): versions + flags + hello-world + limits, updated from worker images.
- Quotas/anti-abuse: per-user submit throttle, anti-fork-bomb cgroups v2, plagiarism hooks (see M9).

### M8. Course (LMS-lite) Superpowers
- Labs as modules with deadlines, late-penalty rules, best-of-K, points → grade formula preview, USOS export (BaCa2 already promises USOS sync — match it).
- Teacher dashboard: at-risk students, unsolved histograms, per-test fail heatmap, bulk feedback, code view with comments.
- Students: progress bar, *"what-if"* grade calculator (powered by `satori-points` logic, now native), deadline calendar feed (ICS).

### M9. Integrity & Proctoring (Opt-in per Contest)
- Moss/JPlag similarity graph + timeline anomaly flags; jury-only view, student appeal flow.
- Exam mode: fullscreen/paste-block option, IP allowlist for lab rooms, time-window tokens, problem order shuffle.
- Audit log: who changed tests/limits/members/scoreboard — V1 has none visible.

### M10. Migration + Interop
- Importers: V1 HTML dump → V2 (contests 251519, UZI series, courses), Athina PDFs, Polygon ZIPs.
- Read-only V1 archive (`archive.satori…`) with permanent `/contest/<id>/problems/<pid>` redirects (protect CLI-in-source comments).
- BaCa2/Kolejka broker compatibility: V2 can dispatch to same Kolejka grid; share `Organization`/USOS mapping.

---

## B. MINOR Improvements (Papercuts — High ROI)

Grouped by where V1 hurts today (many already proven by `satori-enhancements` — promote to core):

**Navigation & accounts**
- Popup contest switcher + recent contest auto-redirect; remember-me + visible session expiry; profile completion meter (affiliation nudge, not reject-loop).
- Human filename error (*"use only A–Z a–z 0–9, renamed suggestion: …"*) instead of silent fail.
- Global search (`contest/problem/user/announcement`) + archived filter that persists.

**Problems list**
- Search/filter/sort, hide solved/hide group (persisted), status dots (OK/ANS green, WA red…), per-row `Results` link, PDF badge vs HTML badge, letter consistency check.
- Virtualized list (fix *"long list loads slowly"*), pagination + `?limit=` respected.

**Submit → Results**
- Auto-refresh + badge/SSE notify (no F5 spam), code syntax highlight + theme choice, copy permalink, `Re-submit` + `Download`.
- Results filters: by problem/verdict/me/team, adjustable `results_limit`, stable deep links `/results/<submit_id>`.
- Compiler errors shown with line numbers + fix hints; TLE/MLE cards explain limit vs used (`1.8 s / 1.0 s`, `312 MB / 256 MB`).

**Ranking**
- Sortable columns, name filter, sticky header + first two cols, live update dot + freeze countdown, CSV/print, team-member expand, penalty tooltip (*"2 wrong → +40 min"*).
- Time in local TZ on hover, clarifications ticker beside board during contest.

**Content & comms**
- Markdown news/subpages, scheduled posts, attachments with previews, real contact form (kill mail-image), forum deep-links per contest.
- Server-time + contest-countdown component; maintenance banner + public status (`judge queue: 4, ETA ~20 s`).

**Teacher micro-UX**
- Member CSV import + pending queue with one-click approve-all-by-filter; e-mail templates; duplicate-contest (e.g. clone `UZI 2025 → 2026`); bulk extend deadline.
- Ranking snapshot export for protocols (AMP eliminations need paper trail).

**A11y/perf/ops**
- Contrast-fixed links, tab order, keyboard submit, focus rings; image `alt`; PL/EN strings audit (no mixed *"Select contest"* in Polish UI unless toggled).
- Edge caching for PDFs/statements, `stale-while-revalidate` scoreboards; Sentry + judge dead-letter queue; exception pages with report ID (no more *"throws exception, us too, sometimes"*).

## B2. Expansion Batch — Problem-Centric UX + More (per request)

> Your example leads this batch: verdict inline on problem list. V1 forces `problems → submit → results` ping-pong. V2 merges them into one cockpit.

### B2.1 Inline verdicts on problem list (flagship)
- **Row chip**: each problem row shows `best verdict pill` (OK green / ANS light-green / WA red / TLE orange / MLE purple / RE pink / CE gray / QUE animated pulse / never-tried outline) + `score` (IOI/course: 72/100) + `tries count`.
- **Expand inline**: click chip → drawer under row with last 3 submits (time, lang, verdict, `view diff`, `re-submit`), no page change. `Full history` link jumps filtered.
- **Live update**: SSE/WS pushes `testing 4/12 → OK` into row without refresh + toast + sound toggle. Fixes extension-only auto-refresh.
- **Submit from row**: `+ Submit` button per row opens modal (paste/file/drop, language auto-detect) with `sample-run` toggle. After judge, row chip animates to new verdict. No redirect.
- **Bulk cues**: `favourite/star`, `hide solved`, `difficulty + tags`, `solved-by %` bar, `PDF vs HTML` badge, `time/memory` on hover.
- **Acceptance**: Playground 500 rows → filter <100 ms, live verdict <2 s after judged event.

### B2.2 Problem list superpowers (Codeforces-style)
- Multi-filter: `status[all|solved|tried|todo] + difficulty + tag + setter + ProblemSet group`, saved views (`UZI warmup`, `Labs 3 todo`), shareable URL `?f=...`.
- Sort: code, name, solves%, difficulty, my-score. Virtualized + skeleton shimmer while loading (fix *"loads slowly"*).
- Keyboard: `/` focus search, `j/k` move, `o` open, `s` submit modal, `h` hide.
- Personal notes per problem (`tricky DP, retry`), private + per-team notes. Export notes.
- Recommendations: `next unsolved closest to your rating`, `upsolve queue` auto-built from failed submits.

### B2.3 Statement + samples ergonomics
- One-click copy sample, `run samples` in-browser (WASM or sample-judge, no penalty), diff viewer for WA (`expected vs got`, whitespace visualize).
- Limits card always visible: `1.0 s (×2 for Python) / 256 MB / stack 64 MB` + language matrix link. Version history of limits (fix *"had OK now TLE"*).
- PDF + Markdown dual view, print-friendly, dark-mode code blocks, PL/EN switch per problem.

### B2.4 Results / submits upgrades
- Grouped by problem with best-first, timeline view, compare any two submits side-by-side, `download all my codes` ZIP (replaces manual Athina pack requests).
- Per-test table when jury allows: test #, time, mem, verdict, checker message. First-fail preview during contest, full after.
- CE/TLE/MLE explainers with fix recipes + link to exact docs line.

### B2.5 Ranking / progress delights
- Mini-rank in sidebar on problem list (`you #7, +1 solve to #5`), sparkline of solves over time.
- Personal progress: `solved X/Y, points Z, streak`, course grade projection (`what-if`), ICS deadlines.
- Contest replay scrubber + freeze curtain animation.

### B2.6 Teacher / jury extras
- Inline rejudge from problem row (`rejudge all WA on test 7`), quarantine buggy problem in one click (replaces silent missing tasks).
- Fail heatmap per problem (which test kills most), cheating-similarity badge, bulk comment on all `WA on A`.
- Clone problem across contests, alias letters per contest (fix letter mismatch), bulk PDF re-export.

### B2.7 Notifications + offline
- Per-problem watch (`notify me on rejudge/limit change/new editorial`), editorial link slot after solve, in-app + e-mail + webhook.
- PWA: cache statements/samples for train/plane, queue submits offline → auto-send.

---

## C. Prioritized Roadmap (Suggested)

- **P0 (V2 MVP, 1–2 quarters)**: M1 shell + M2 API/CLI + M3 auth/teams + M4 ICPC+labs templates + M6 submit/results live + M7 Kolejka wiring + B submit/results/ranking papercuts + V1 redirect import.
- **P1**: M5 authoring v1 (MD+tests+checkers), M8 teacher dashboard + USOS export, M4 freeze/virtual, M10 full archive.
- **P2**: M9 plagiarism/exam, M5 git/Polygon bulk, analytics + webhooks marketplace, mobile PWA offline statements.

---

## D. Risks & Trade-offs

- **Rewrite vs fork V1**: V1 Django core is salvageable but *"unsafe"* + no API; rewrite API+UI while reusing Kolejka images = fastest safe path. Keep V1 read-only 12 mo.
- **BaCa2 overlap**: coordinate — share Kolejka + USOS mapping + Package format instead of competing course features.
- **Judge fairness**: per-language multipliers + transparent limits cost jury time upfront, save endless *"why TLE?"* appeals later.
- **Scope creep**: Playground nostalgia (letters, PDFs) — preserve via archive + importers, don't let legacy quirks block new authoring model.

---

## E. What to Ask Users Next (for Build Spec)

1. Teacher flow walkthrough (create lab → add test → set limits → grade) — record clicks.
2. UZI jury rules: freeze? clarifications? team accounts vs merged logins? penalty minutes?
3. Verdict visibility policy during vs after contest (full tests or first-fail?).
4. USOS integration depth (read groups vs write grades?) + SSO provider.
5. Scale: peak submits/min, worker count, retention (keep all submits since 2011?).

---

## Sources Absorbed

V1 spec + `satori-enhancements` feature list (declutter, tab-order, auto-redirect, keep-login, problem highlights/hide, popup switcher, sortable/searchable/sticky ranking, paste-submit, auto-refresh+notify, highlight) + 4 CLIs + `koishi/satori-points` URL patterns + Kolejka (`Server/Client/Worker/Observer/Foreman`, `kolejka/satori:*`) + `kolejka-judge` + BaCa2 (per-course DBs, USOS, Broker).
