# Satori V2 — Remediation & Feature Plan v2

> Date: 2026-10-19
> Source: `docs/FIX_PLAN.md` + two audit passes on API, web, judge, CLI, importers, seeds, docs, tests.
> Goal: make contests safe and trustworthy, finish the half-built teacher/student flows, then add the features that make the platform worth using.
> Delivery model: **serial seams first, then 6–7 parallel workstreams with disjoint file ownership.**

---

## 0. Executive summary

The platform already has a credible skeleton: contests, problems, tests, submissions, SSE verdicts, ICPC/IOI/LABS ranking, lab grades, exam settings, webhooks, CLI, and a modern web shell.

It is **not yet safe to run a real contest**. The blockers are not missing polish; they are truth, access, and lifecycle problems:

1. Expected outputs and compile logs leak to non-owners.
2. Contest membership, end time, `teamId`, and `contestId` are not enforced on submission.
3. The scoreboard can be read around `hidden` / `me-only` through `/api/submits`.
4. Anyone can rejudge any submit.
5. A single team row replaces the whole individual scoreboard.
6. UI-created contests have no real end time (`stopAt` vs `endAt`).
7. Freeze never lifts; `unfreezeAt` is computed but unused.
8. EXAM/TAKEHOME/PLAYGROUND rank as ICPC; `scoreboardMode` is dead.
9. Grade scales disagree between page, preview, board, and CSV.
10. C submissions compile as C++; per-language limits are broken.
11. `custom` checker is substring matching, not a checker program.
12. The teacher authoring UI cannot view/edit/delete existing tests and cannot set subtask points.

The plan below fixes those first, then completes teacher/student workflows, then adds the high-value features: real checkers, validators, test management, gradebook, analytics, exam enforcement, team lifecycle, integrity, PWA, and platform hardening.

---

## 1. Locked decisions

These decisions remove ambiguity. Everything else in the plan depends on them.

| # | Decision | Locked answer |
|---|----------|---------------|
| D1 | Contest time | `endAt` is canonical. `stopAt` is a deprecated input alias, normalized to `endAt` on write. UI labels it “End”. No consumer reads `stopAt`. |
| D2 | Scoring mode | `scoreboardMode` is canonical, fallback `mode`. Explicit map: `ICPC`, `IOI`, `LABS`/`COURSE`. `EXAM`/`TAKEHOME` default to `IOI`; `PLAYGROUND` defaults to `IOI`; `VIRTUAL` defaults to `ICPC`. No implicit ICPC fallthrough. |
| D3 | Grade scale | One `settings.gradeScale` used by student page, teacher preview, LABS board, and export. Default `90:5,75:4,50:3,0:2`. `usosId` is a first-class user field. |
| D4 | Contest access | Add `visibility: public | private | exam`. Private/exam require membership to read problems, submit, and appear on boards. `endAt` blocks submissions except `PLAYGROUND`/upsolve mode. |
| D5 | Team identity | `team.members` is canonical (array of user IDs). Migrate `memberIds` → `members`. `submit.teamId` is validated against the caller’s team. A contest uses teams only when explicitly `teamMode: true`, never because “some team row exists”. |
| D6 | Per-language limits | `limits.perLang[lang]` is **absolute milliseconds**, not a multiplier. UI says “Python limit (ms)”. Remove/repurpose `LANGUAGE_MATRIX.timeMult` as display-only. Migrate lowercase keys to canonical language names. |
| D7 | Checkers | `token`, `float` (configurable tolerance), `custom` (program with a defined contract). No substring “custom”. |
| D8 | Judge execution | Judge runs in a separate worker with a persistent queue. `spawnSync` leaves the HTTP event loop. Sandboxing is a separate task behind `J.runBinary`. |
| D9 | API errors | Every error is `{ error: { code, message, hint, field? } }`. The web client parses and surfaces it. No `throw new Error("422 /api/...")`. |
| D10 | Unfinished UI | Hide behind a feature flag or remove. No fake success toasts. “Coming soon” is honest only if it has a flag and no button. |
| D11 | Parallel work | Only after the serial seams are complete. One owner per file. No two agents edit the same file. |
| D12 | Backward compatibility | Keep accepting old field names for one release: `stopAt`, `memberIds`, `perLang.python`. Normalize on write and log a deprecation warning. |

---

## 2. Current red items (must be true after Gate A)

| Area | Red item | Gate A acceptance |
|------|----------|-------------------|
| Leak | Non-owner `/api/submits` returns `perTest`, expected/got, `compileLog` | Non-owner response has only verdict/time/points/lang/timestamps; regression test |
| Access | Non-member can read problems and submit | Private/exam contest returns 403 for non-member |
| Access | `endAt` not enforced | Submit after end returns 409 except upsolve mode |
| Access | Arbitrary `contestId`/`teamId` accepted | Submit rejected when problem/contest/team mismatch |
| Access | Any auth user can rejudge any submit | Non-admin gets 403 |
| Board | `me-only` filter only in React | Server filters rows; `/api/submits` respects hidden board |
| Board | `hidden` board leaks via `/api/submits` | Submit list gated by board mode |
| Time | `stopAt` written, `endAt` read | One canonical field; UI-created contest has a real end |
| Freeze | `unfreezeAt` unused | Board includes post-freeze submits after unfreeze |
| Scoring | EXAM/TAKEHOME/PLAYGROUND rank as ICPC | Template-specific ranking; test each |
| Scoring | Grade mismatch page vs CSV | One scale; 85% → same grade everywhere |
| Judge | C compiled as C++ | C compiled with `gcc` and `.c`; C-only test passes |
| Judge | Per-language limit key/unit broken | Editor writes `Python: 2000`; judge applies 2000ms |
| Judge | `custom` checker is substring | Custom checker program runs; multiple answers accepted |
| Authoring | Existing cases cannot be viewed/edited/deleted | Test manager supports add/view/edit/delete |
| Authoring | Group points cannot be set | Points editor; total per problem preview |
| Grading | Teacher matrix uses a second formula | Matrix uses `computeLabsGrade` |
| UX | API error hints discarded | Forms show server `message` + `hint` |
| UX | Cache leaks across users | Cache key includes user/token; cleared on auth change |
| Deploy | Client defaults to localhost | Same-origin `/api` default or build-time guard |
| Ops | Production auto-seeds known passwords | Seed only with explicit `SATORI_DEMO_SEED=1` |
| Security | Webhook SSRF, demo XSS, clarification forgery | Fixed and covered by negative tests |

---

## 3. Release gates

### Gate A — “Safe to run a real contest”
Security/access, contest time, scoring mode, freeze, grade scale, C compiler, perTest leak, error surfacing, cache, deployment base.
Target: ~7–10 working days with the parallel batches below.

### Gate B — “Credible course”
Test manager, custom checker, validators/reference solution, gradebook/manual overrides, announcements/clarifications, exam enforcement, team lifecycle.
Target: ~2 weeks after Gate A.

### Gate C — “Public contest”
Async judge worker, freeze replay, team scoreboard, integrity, analytics, webhooks hardening, load test.
Target: ~2 weeks after Gate B.

### Gate D — “Platform”
Password reset/2FA/SSO, org/admin CRUD, PWA, CLI/SDK parity, OpenAPI generation, accessibility, observability, backups/Postgres.
Target: ongoing after Gate C.

---

## 4. Serial seams (must finish before parallel work)

`apps/api/src/server.js` is a 1,773-line monolith and `apps/web/lib/client.js` is a 962-line shared blob. Parallel agents editing those will conflict. Do these first, serially.

| ID | Task | Output | Size |
|----|------|--------|------|
| S0-00 | Initialize git + baseline commit + worktree strategy | `.git`, baseline tag, branch convention, `AGENTS.md` note | S |
| S0-01 | Split API into route modules | `apps/api/src/routes/{auth,contests,problems,submits,ranking,grades,comms,admin,webhooks}.js`; `lib/authz.js`; `lib/contestAccess.js`; `server.js` becomes a router | M |
| S0-02 | Split web client | `lib/api.js` (fetch/cache/errors), `lib/i18n.js`, `lib/verdict.js`; re-export from `lib/client.js` for compatibility | M |
| S0-03 | Test harness + CI | `tests/helpers.js` (start server, temp data, login, seed, waitJudged); `npm test`; optional `npm run lint`; coverage of seams | S |
| S0-04 | Shared error contract | API error helper; web `ApiError` class with `status/code/message/hint/field`; all pages show hint | S |
| S0-05 | Data migration script | `scripts/migrate-v2.js`: `stopAt`→`endAt`, `memberIds`→`members`, `perLang` keys, `scoreboardMode`, `gradeScale`, `usosId`; idempotent | S |
| S0-06 | Feature flags / hide fakes | `lib/flags.js`; remove fake “queued” toasts; hide ZIP/PDF/announcement-email/PWA until real | S |
| S0-07 | Baseline test matrix | Tests for authz, submit, contest time, ranking mode, grade parity, checker, leaks; all red tests skipped or marked TODO | S |

**Why serial:** after S0-01/S0-02, workstreams can own files without stepping on each other.

---

## 5. Parallel workstreams

Each workstream owns files. Tests live in separate files so test agents can also work in parallel.

| WS | Name | Owns | Parallel-safe after |
|----|------|------|---------------------|
| A | Security & access | `routes/submits.js`, `routes/problems.js` auth parts, `lib/authz.js`, `lib/contestAccess.js`, `tests/security-*.test.js` | S0-01, S0-03, S0-04 |
| B | Contest engine | `lib/ranking.js`, `lib/contestTime.js`, `routes/contests.js`, `routes/ranking.js`, `apps/web/app/contests/[id]/ranking/page.js`, `tests/contest-*.test.js` | S0-01, S0-05 |
| C | Judge & authoring | `packages/judge/**`, `routes/judge.js`, `apps/web/components/ProblemEditor.js`, `apps/web/components/ui/CodeEditor.js`, `tests/judge-*.test.js` | S0-01, S0-02 |
| D | Grading & teacher console | `routes/grades.js`, `apps/web/app/contests/[id]/manage/grade/page.js`, `manage/settings/page.js`, `manage/members/page.js`, `tests/grades-*.test.js` | S0-01, S0-05 |
| E | Student experience | `ProblemCockpit.js`, `app/contests/[id]/problems/[pid]/page.js`, `submit/page.js`, `results/**`, `lib/api.js`, `hooks/useApi.js`, `tests/student-*.test.js` | S0-02, S0-04 |
| F | Comms & exam | `routes/comms.js`, `clarifications/page.js`, `manage/announcements`, `ExamGuard.js`, `manage/integrity`, `tests/comms-*.test.js` | S0-01, S0-04 |
| G | Platform & docs | `next.config.js`, `app/layout.js`, `app/languages`, `app/status`, `demo.html`, `openapi.yaml`, `docs/**`, `tests/platform-*.test.js` | S0-02, S0-04 |

**Hotspot rules**
- Only C edits `ProblemEditor.js`.
- Only E edits `ProblemCockpit.js` and submit/problem/results pages.
- Only D edits `manage/grade` and `manage/settings`.
- Only F edits `clarifications`, `announcements`, `ExamGuard`, `manage/integrity`.
- Only G edits docs, demo, OpenAPI, Next config, languages/status.
- `lib/client.js` is frozen after S0-02; new code imports from `lib/api.js`, `lib/i18n.js`, `lib/verdict.js`.

---

## 6. Task catalog

Sizes: S ≈ half day, M ≈ 1–2 days, L ≈ multi-day. `∥` = can run in the same batch as other tasks in the same lane.

### Batch 0 — serial seams
S0-00 … S0-07 above.

### Batch 1 — Gate A (parallel, 6–7 lanes)

#### Lane A — Security & access
| ID | Task | Size | Depends | Acceptance |
|----|------|------|---------|------------|
| A1 | Strip `perTest`/`compileLog`/expected/got for non-owners; keep verdict/time/points | S | S0-01 | Negative test: anon sees no perTest/compileLog; owner does |
| A2 | Clarifications: require membership; whitelist `{question, problem}`; separate admin answer route | S | S0-01 | Student cannot spoof author/answer/contest; jury can answer |
| A3 | News/subpages: whitelist fields; no body `contestId`/`authorId` override | S | S0-01 | Admin of A cannot inject into B |
| A4 | Webhook SSRF guard: http(s), block loopback/private/link-local, no redirects, DNS pin; signing secret | M | S0-01 | Internal URL rejected; signed delivery test |
| A5 | Global `/api/webhooks` GET auth; scope by contest/admin | S | S0-01 | Anon 401; only own/contest hooks |
| A6 | Demo XSS: build DOM with textContent; valid sample code; smoke asserts OK | S | — | Contest name `<img onerror>` renders as text; demo smoke OK |
| A7 | Production seed guard: require `SATORI_DEMO_SEED=1`; no known passwords otherwise | S | S0-01 | Boot empty prod → no users; explicit seed → demo users |
| A8 | Submit access: membership, `endAt`, `contestId`/`problemId` match, `teamId` membership, private/exam visibility | M | S0-01 | Matrix: non-member 403, after-end 409, wrong team 403, wrong contest 403 |
| A9 | Single-submit rejudge authz (`canManageProblem`); reset `judgedAt` | S | S0-01 | Student 403; admin 200 |
| A10 | Board modes server-side: `hidden`/`me-only` on ranking, CSV, live, `/api/submits`; recheck on live tick | M | S0-01 | `me-only` API returns only me; hidden 403; mid-stream hide |
| A11 | Contest projection: public GET omits `settings.exam`, `members`, `pending`, `admins`; admin gets full | S | S0-01 | Anon contest GET has no IP allowlist/time window/member IDs |
| A12 | Member roles: persist `role` (`participant/teacher/jury`), remove admin on delete, show role, exclude teachers from boards/grades | M | S0-01 | Delete teacher revokes admin; role distinct; teacher not ranked |
| A13 | Test route cross-problem: validate group belongs to problem; whitelist case/group fields | S | S0-01 | Admin A cannot write to B’s group; negative test |
| A14 | Rate limits: submit per user, register per IP, exam violations; return 429 with retry hint | S | S0-01 | Flood tests |
| A15 | Security headers/CSP: web + API; no inline eval; frame-ancestors; referrer policy | S | — | Header test; demo CSP allows only self |
| A16 | Cache auth: key by user/token, clear on login/logout/refresh | S | S0-02 | Switch accounts → no stale `/api/me` or joined list |
| A17 | Production API base: same-origin `/api` default; build fails if `NEXT_PUBLIC_API` missing in prod | S | S0-02 | Built web calls same origin; no localhost |
| A18 | Auth/client error body: parse `{error}` and surface message+hint; replace all `e.message` toasts | S | S0-04 | LATE/SAMPLE_OFF/FILENAME tests show hints |

#### Lane B — Contest engine
| ID | Task | Size | Depends | Acceptance |
|----|------|------|---------|------------|
| B1 | `endAt` canonical: UI, wizard, settings, ICS, deadlines, bulk extend, home, timer; `stopAt` alias + migration | M | S0-05 | UI-created contest has real end; edit stop changes end; tests |
| B2 | Scoring mode: `scoreboardMode` resolution, explicit map; EXAM/TAKEHOME → IOI; PLAYGROUND → IOI; `?mode` honored or removed | M | S0-01 | Each template ranks correctly; badge shows one mode |
| B3 | Freeze/unfreeze: `unfreezeAt`, `?unfrozen`, replay view, IOI/LABS freeze behavior, live recheck | M | B2 | Post-freeze submits appear after unfreeze; hidden mid-stream stops |
| B4 | Grade scale single source: `settings.gradeScale`; student page, preview, board, CSV; add `usosId` to register/me/CSV | M | S0-05 | 85% same grade everywhere; USOS ID round-trips |
| B5 | Team identity: `members` canonical; migrate; validate submit team; `teamMode` explicit; team-aware chips/grades; no board flip | M | S0-05 | One team does not hide individuals; team submit only by member |
| B6 | Settings penalty: read/write `settings.penaltyMin`; preserve `dropWorstN`; add dropWorst UI | S | S0-05 | Edit penalty changes ranking; save does not delete dropWorst |
| B7 | Grade preview defaults: use actual null/undefined; no 14-day/50% overrides; correct late source | S | S0-05 | Preview with no cap == actual grade |
| B8 | `_score`: max over all submits, first accepted separately | S | S0-01 | Later 100-point accepted beats earlier 10-point |
| B9 | Contest timer/start/end/freeze on all contest pages; show even with deadline policy off | S | B1 | ICPC contest shows start/end/freeze countdown |
| B10 | Contest list: membership state, memberCount, drafts hidden from non-admins, pending tab state | S | S0-01 | Apply → Pending → Joined; drafts not public |

#### Lane C — Judge & authoring
| ID | Task | Size | Depends | Acceptance |
|----|------|------|---------|------------|
| C1 | C compiler: `gcc` + `.c`; cache probes; status/matrix truth | S | S0-01 | C-only code passes; C++ code in C rejected |
| C2 | Limits: canonical `perLang` absolute ms; editor key/unit; remove timeMult confusion; validate limits | S | S0-01 | Python 2000ms applied; 60s not silently 30s |
| C3 | Java memory: pass problem `memoryMb` to `-Xmx`; document JVM overhead | S | S0-01 | 512MB problem allows >256MB |
| C4 | Custom checker program: `checker.<lang>`, contract stdin input/expected/actual, exit 0/1, message, timeout, compile once | L | S0-01 | Multiple accepted answers; WA message surfaced; bad checker fails closed |
| C5 | Validator + reference solution + stress: validate tests, generate expected outputs, run model/brute, block publish on failure | L | C4 | Invalid test rejected; model must AC before publish |
| C6 | Test manager: multi-line editors, view/edit/delete case, group points/subtask, per-case limits, duplicate/reorder, ZIP import/export | L | S0-02 | Multi-line tests; group 10+20 points; delete one case |
| C7 | Sample checker + fallback: use group checker for samples; require ≥1 case to publish/submit | S | C4 | Float sample passes; empty problem cannot publish |
| C8 | Trigger fixtures: gate to demo/tests only | S | S0-01 | `TLE-TRIGGER` in real code does not force TLE |
| C9 | Async judge worker: persistent queue, lease, retry, dead-letter, requeue QUE on boot; remove `spawnSync` from API | L | S0-01 | API responsive during judge; restart recovers QUE |
| C10 | Editor fields: name/code/tags/difficulty/deadline/set; tag/difficulty facets | M | S0-02 | Existing problem rename/tag/deadline works |
| C11 | Clone: copy tests/groups, remap set IDs and aliases | S | S0-01 | Cloned problem judges; target alias works |
| C12 | Limit history + versions routes/UI: correct fields, diff | M | S0-01 | Editor shows history; version diff renders |
| C13 | Checker/validator/test UI feedback: compile log, checker message, points preview | M | C4/C6 | Teacher sees why checker rejected |
| C14 | Language matrix: availability, hello-world all 6, per-language limit display | S | C1 | 6 rows; unavailable hidden/flagged |
| C15 | Sandbox adapter behind `J.runBinary` (Docker/cgroups), keep local fallback | L | C9 | Memory/network/process tree blocked in container |

#### Lane D — Grading & teacher
| ID | Task | Size | Depends | Acceptance |
|----|------|------|---------|------------|
| D1 | Matrix uses `computeLabsGrade` (late, bestOfK, dropWorst, floor, weights) | M | B4/B6 | Matrix total == `/grade` total |
| D2 | Manual overrides: per student/problem points, excused, note, audit | M | D1 | Override changes grade; audit row |
| D3 | Extensions/late passes per student or group | M | D1 | Extended deadline changes late units |
| D4 | Grade release/publish + student visibility window | M | D1 | Students see grades only after release |
| D5 | Gradebook export: BOM, scale, USOS ID, per-problem cells; import USOS IDs | S | B4 | Excel opens Polish names; IDs present |
| D6 | Bulk actions: rejudge by verdict/problem, extend selected, download all student codes ZIP | M | A9 | Teacher ZIP contains all members’ codes |
| D7 | Analytics: score distribution, per-test heatmap, at-risk, problem quality, first blood | M | D1 | Charts/tables from real data |
| D8 | Settings completeness: all scoring fields, validation, dirty guard, save preserves unknown keys | M | B6 | No field loss on save |
| D9 | Readiness checklist real: grade/integrity/webhooks state; correct links | S | — | 100% reachable |
| D10 | Members UX: roles, demote, CSV pending cleanup, USOS column, team roster | M | A12 | Teacher/jury distinct; pending not duplicated |
| D11 | Audit: actor login, problem target includes contest, diffs | S | S0-01 | Filter by who/action works; problem changes appear |

#### Lane E — Student experience
| ID | Task | Size | Depends | Acceptance |
|----|------|------|---------|------------|
| E1 | Submit editor: language selector (canonical values), templates, autosave, inline sample result/diff, custom input | M | S0-02 | Python/Rust/JS selectable; sample result shown |
| E2 | Problem page: `_best`/alias, watch server-side, limits card, deadlines, KaTeX, editorial authoring | M | S0-01 | Solved state; editorial after solve; math renders |
| E3 | Results: sampleOnly badge/filter, problem code/name, pagination/total, live refresh, group/points columns, resubmit lang | M | S0-02 | Sample runs distinguishable; >50 loads more |
| E4 | Notes: fix `{items}` shape, per-team notes, export all | S | S0-02 | Reload shows note; team note shared |
| E5 | Cockpit: team-aware chips, alias, drawer close, first-accepted score, keyboard clamp | S | S0-02 | Teammate solve shows; drawer hides |
| E6 | Home: render sparkline/miniRank or remove dead request; deadlines/continue with `endAt` | S | B1 | No dead fetch; sparkline visible |
| E7 | Notifications: prefs honored, types emitted, grade feedback text, watch | M | S0-01 | Disable in-app → no item; rejudge/limit notify |
| E8 | Search: announcements, problem code/tags, user links | S | S0-01 | Search finds announcement/code |
| E9 | Profile: edit name/email, session expiry, current-device revoke | S | S0-01 | Name/email save; expiry shown |
| E10 | Accessibility/mobile: labels, focus, sticky submit, code editor, tap targets | M | — | Lighthouse a11y ≥90; mobile submit 3 taps |

#### Lane F — Comms & exam
| ID | Task | Size | Depends | Acceptance |
|----|------|------|---------|------------|
| F1 | Clarifications: jury answer UI, `mine`, private/global, notify asker, templates | M | A2 | Jury answers; student sees answer; `mine` works |
| F2 | Announcements: student page/tab, schedule, in-app/email/RSS, attachments, read receipts | M | A3 | Student reads scheduled post; email queued |
| F3 | Exam enforcement: server-side time window/IP, per-student code, real shuffle, auto-submit | L | S0-01 | Wrong IP/window 403; order differs; auto-submit |
| F4 | ExamGuard mount in contest layout on all pages; fullscreen/tab/blur; no opt-in bypass | M | F3 | Problem/submit page guarded; refresh still guarded |
| F5 | Violations detail: who/type/detail/time, clear/resolve, audit | S | F3 | Jury sees list, not count |
| F6 | Appeals: student create, jury resolve, notify; link from result | M | A2 | Student can appeal; status updates |
| F7 | Integrity: per problem, exclude same user, normalize identifiers, MOSS/JPlag adapter, timeline context | M | S0-01 | Same problem only; duplicate code flagged |
| F8 | Webhooks: event catalog, signature, replay, delivery filter | S | A4 | Signature verifies; replay works |

#### Lane G — Platform & docs
| ID | Task | Size | Depends | Acceptance |
|----|------|------|---------|------------|
| G1 | OpenAPI: generate from routes; `/api/openapi.json` returns JSON; `/api/openapi.yaml` YAML | M | S0-01 | Spec covers all routes; JSON parses |
| G2 | Docs: README/API/FRONTEND/JUDGE align with reality; remove false claims | S | — | Doc review checklist |
| G3 | Demo: valid code, no innerHTML, smoke asserts OK | S | A6 | Demo login → submit → OK |
| G4 | PWA: manifest in public, icons, SW registration, auth-safe cache, outbox | M | A16 | Installable; offline statement; queued submit |
| G5 | Auth: password reset, email verification, TOTP 2FA, SSO/OIDC hooks | L | email | Reset flow; 2FA login |
| G6 | Org/admin CRUD; affiliation validation; domain auto-approve | M | S0-01 | Create/edit org; auto-approve works |
| G7 | CLI/SDK parity: refresh persistence, `problems` without contest, status watch, `--token`, SDK SSE/results | M | S0-01 | CLI e2e; SDK parity |
| G8 | Observability: judge metrics, Sentry, audit actor, queue depth, maintenance banner | M | C9 | Dashboard/logs; alert on queue |
| G9 | Postgres repository + migrations + backups | L | S0-01 | Store swap behind interface; backup/restore |
| G10 | Load test: 50 concurrent submits, 500-row cockpit, SSE; fix bottlenecks | M | C9 | p95 submit accepted; no API freeze |

---

## 7. Parallel execution map

### Batch 0 (serial)
S0-00 → S0-01 → S0-02 → S0-03 → S0-04/05/06/07 (can overlap where files differ).

### Batch 1 (Gate A, 7 lanes in parallel)
- Lane A: A1–A18 (security/access).
- Lane B: B1–B10 (contest truth).
- Lane C: C1–C3, C8, C10–C12 (judge basics + editor correctness).
- Lane D: D1, D7–D11 (grading truth + teacher basics).
- Lane E: E1–E6, E9 (student basics).
- Lane F: F1, F3–F5 (clarifications + exam basics).
- Lane G: G1–G3, G7 (docs/demo/CLI basics).

Run A1/A2/A3/A4 first within Lane A (they are the blockers); B1/B4 first within Lane B; C1/C2 first within Lane C.

### Batch 2 (Gate B, parallel)
- Lane A: A13–A18 hardening/tests.
- Lane B: B3 replay/freeze UX, B5 team-aware cells, B9 timer.
- Lane C: C4–C7, C9, C13–C15.
- Lane D: D2–D6, D12 (manual grading, extensions, release, bulk, analytics).
- Lane E: E7, E8, E10 (notifications, search, a11y).
- Lane F: F2, F6–F8 (announcements, appeals, integrity, webhooks).
- Lane G: G4, G6, G8 (PWA, org, observability).

### Batch 3 (Gate C/D, parallel)
- Lane C: C15 sandbox, C9 load hardening.
- Lane D: analytics/gradebook polish.
- Lane F: integrity MOSS/adapter, exam polish.
- Lane G: G5 auth, G9 Postgres, G10 load, G11 review.
- QA: e2e, security review, a11y, docs.

### Agent assignment
| Batch | Agents | Prompt shape |
|-------|--------|--------------|
| 0 | 1 CoderAgent + 1 TestEngineer | serial seams; no parallel writes |
| 1 | 7 CoderAgents, one per lane | “Load context bundle; own only these files; implement tasks; run lane tests” |
| 1 | 2 TestEngineers | one for A/B, one for C–G; separate test files |
| 1 | 1 CodeReviewer | review all lane diffs after batch |
| 2 | 7 CoderAgents + 2 TestEngineers + 1 Reviewer | same lane ownership |
| 3 | 3 CoderAgents + e2e TestEngineer + Reviewer | integration, load, security, a11y |

**Context bundle per agent** (`.tmp/context/<session>/bundle.md`):
- Locked decisions D1–D12.
- Owned files and forbidden files.
- Task IDs and acceptance criteria.
- Relevant audit excerpts.
- Test commands.
- Definition of done.

**Conflict rules**
- No shared `server.js` after S0-01.
- No shared `lib/client.js` after S0-02.
- One owner per web page.
- If a task needs a file owned by another lane, the owner lane exposes a helper or the task moves to that lane. No cross-lane edits.

**Task JSON**
After Batch 0, use TaskManager to create:
```
.tmp/tasks/satori-v2/task.json
.tmp/tasks/satori-v2/subtask_NN.json
```
Each subtask: `{ id, title, status, parallel, depends_on, lane, files, acceptance, tests }`.
BatchExecutor runs Batch 1 lanes in parallel, waits for all, then Batch 2.

---

## 8. Test plan

### Unit
- `ranking.js`: ICPC/IOI/LABS, freeze, unfreeze, late, bestOfK, dropWorst, floor, tiers, miss deduction, zero-point accepted.
- `gradeLabs`: one scale, USOS, weights, caps.
- `validators`: filenames, languages, emails.
- `judge`: token/float/custom, validators, output cap, timeout, C vs C++.
- `contestTime`: `endAt` only, alias migration, timezone.

### Integration
- Auth matrix: anon/student/member/teacher/jury/admin/superadmin per route.
- Submit: member/non-member, before/after end, team/non-team, contest mismatch, draft/hidden/quarantine, late hard/soft.
- Board: hidden, me-only, freeze, unfreeze, teams, CSV/live parity.
- Grade: page/preview/board/export parity; overrides; extensions; release.
- Authoring: create problem → add tests → edit/delete → checker → publish → submit.
- Comms: ask → answer → notify; announcement schedule/read; appeal.
- Exam: IP/time/code/shuffle/violation/auto-submit.
- Platform: cache switch, error hints, OpenAPI JSON, demo XSS, webhook SSRF.

### E2E
1. Teacher creates contest (choose goal) → adds problems → adds multi-line tests → sets points/checker → publishes.
2. Student opens problem → copies sample → submits → sees live verdict → opens result → sees group points.
3. Teacher opens grade → matrix matches `/grade` → adds override → exports CSV with USOS.
4. Exam: student enters code → shuffled order → paste blocked → violation logged → auto-submit.
5. Admin hides board → student API cannot read it → unfreeze → board appears.

### Non-functional
- Load: 50 concurrent submissions; API does not block; queue drains.
- Security: no perTest/compileLog leaks; no SSRF; no XSS; no auto-seed.
- A11y: keyboard flow, labels, focus, contrast.
- Docs: every documented route exists; no fake claims.

---

## 9. Definition of Done

Every task is done only when:
- Positive and negative test exist and pass.
- API returns `{error:{code,message,hint}}` for rejects.
- UI renders the server hint, not `422 /api/...`.
- No fake success toast; unfinished feature is flagged/hidden.
- Docs/OpenAPI updated if contract changed.
- Data migration is idempotent and backward-compatible.
- `npm test` green; lane test green.
- Reviewer approved the lane.

A release gate is done only when:
- All Gate tasks pass.
- E2E script passes on a clean data dir.
- Security review signs off.
- No open P0/P1 from the audit.
- Plan updated with actual status.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `server.js` monolith blocks parallel work | S0-01 split before any lane |
| Parallel agents conflict | file ownership matrix + no cross-lane edits |
| `stopAt`/`scoreboardMode`/`memberIds`/`perLang` ambiguity | D1/D2/D5/D6 + migration + alias acceptance |
| Judge worker extraction is large | C9 behind `J.runBinary`; async queue first, sandbox later |
| Email/PWA/SSO external dependencies | feature flags; ship stub-free UI |
| Exam browser limits are not real lockdown | server-side window/IP/code; log client signals honestly |
| Grade changes break student trust | one scale; preview == actual; audit overrides |
| Custom checker security | run in same sandbox; timeout; fail closed; no network |
| Data loss on settings save | preserve unknown keys; diff tests |
| False “done” | Definition of Done + Gate checklist |

---

## 11. First 10 actions after approval

1. S0-00 git baseline + worktree convention.
2. S0-01 API route split; S0-02 client split.
3. S0-03 test harness; S0-04 error contract.
4. A1 perTest/compileLog strip; A2 clarification forgery; A3 webhook SSRF; A6 demo XSS.
5. A8 submit access; A9 rejudge authz; A10 board modes.
6. B1 `endAt`; B4 grade scale; B2 scoring mode.
7. C1 C compiler; C2 limits.
8. D1 grade matrix; B6 penalty/dropWorst.
9. E1 submit editor; E2 problem page.
10. Batch 1 review + E2E smoke; then Batch 2.

---

## 12. Status board

| Item | Status | Notes |
|------|--------|-------|
| S0-00 git baseline | DONE | `b23e26f`, `.openchamber/.playwright-mcp/.tmp` ignored |
| S0-01 API route split | IN PROGRESS | background agent |
| S0-02 web client split | DONE | `lib/api.js`, `lib/i18n.js`, `lib/verdict.js`, facade `lib/client.js`; commit `3c49c6e` |
| S0-03 test harness | DONE | `tests/helpers.js`, `tests/harness.test.js`; dynamic port |
| S0-04 ApiError contract | DONE | `ApiError` keeps status/code/message/hint/field; `tests/web-api.test.js` |
| S0-05 migration script | DONE | `scripts/migrate-v2.js`; dry-run + `--apply` + backup; tested on temp copy |
| S0-06 flags / fake toasts | DONE | `lib/flags.js`; bulk PDF + ZIP/PDF imports + request-access fakes removed/gated |
| S0-07 gate tests | DONE | lane tests + harness + migration + web-api + platform; full suite 147/147 |
| Gate A | DONE (core) | Security A1–A18; contest B1–B8; judge C1–C3/C8; grade D1/D4/D5/D7/D8; student E1/E4/E5; comms/exam F1/F3–F7; platform G1–G3/G7. Web build green. |
| Gate A polish | PARTIAL | A15 headers/report-only CSP DONE; B9 timer DONE; B10 membership/drafts DONE; D11 audit actor/filter DONE; problem-page KaTeX, profile edit remain |
| Gate B | DONE (core) | H authoring/checker (custom checker, validators, test manager, editor fields, clone/history), I student web, J announcements/notifications, K gradebook/bulk all committed. 179/179 tests, build green. |
| Gate C | IN PROGRESS | L async judge, O teams, P auth reset/2FA running; M validators/reference DONE; N PWA/offline DONE |
| Gate C next | TODO | auth G5 (reset/2FA), org G6, load/Postgres/observability |
| Gate D | TODO | SSO/2FA depth, org admin, CLI/SDK depth, MOSS adapter |

Commits so far: `b23e26f` baseline, `6ed2dde` harness/migration/flags, `3c49c6e` web client split, `9ca9ee1` web ApiError, `b503272` import flags, `14a8df3` UI polish, `e19ba5e` migration tests, `be57cab` API route split, `5aecfb6` ranking freeze, `0f2cc9a` judge truth, `e743dbf` demo truth, `dda9ce6` student editor/notes, `89642e0` contest engine, `6efb9cf` platform/docs/CLI, `30ed0bd` OpenAPI JSON, `d317ec3` grading, `9c66736` Gate A security/comms/integration, `8f72c25` announcements, `d8a402b` OpenAPI RSS, `fd817d0` contest membership/drafts, `cd96355` security headers, `3975db0` audit, `9589b42` authoring/checker, `009ab73` student2, `b0e4bf0` gradebook, `d234cf8` notification prefs/privacy, `7414c80` Batch 2 green, `c130223` PWA, `82fd4df` contest timer, `2de4dfb` validators/reference, `76a9dec` API docs.

Update this table as work lands. Do not mark a gate done without the Gate checklist and E2E.
