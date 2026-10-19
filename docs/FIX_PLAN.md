# Satori V2 — Core Fix Plan

> Source: gap audit 2026-10-17 (57 findings: 7 critical / 17 high / rest medium).
> Audited: API (`apps/api/src/server.js` + libs), web (student + teacher flows), CLI/SDK, judge, importers, `openapi.yaml`, docs, tests, seeds.
> Site purpose: host contests (ICPC/IOI) and courses (LABS/EXAM).

## How to use this plan

- Fix order: **security → judge truth → broken promises → missing features → hygiene**. Nothing ships to real users before Phase 0 is done.
- Task IDs (S0-1, S1-2, …) for referencing. `[S]` ≈ half day, `[M]` ≈ 1-2 days, `[L]` ≈ multi-day/infra.
- Every API gate/change needs a negative test (403/422 case) in `tests/`.
- Decision rule for dead UI: endpoint is `[S]` → implement; larger → hide the UI behind a flag and note it, never leave dead buttons.
- Traceability: audit tabs → this plan: *Critical* → Phase 0 (+1); *Broken: UI→404* → Phase 2 (+3); *Wrong behavior* → Phase 3; *Not implemented* → Phase 4; *docs/tests drift* → Phase 5.

---

## D. Decisions (locked 2026-10-17)

| # | Decision | Locked answer |
|---|----------|---------------|
| D1 | Language matrix | Real runners: C, C++17, Python, **Java, Rust, JavaScript**; drop **SQL, CUDA** from matrix (submission blocked) until serviced. (S1-1) |
| D2 | Dependency policy | Allow small allowlist: unzip/zip + mail libs. Core API otherwise stays stdlib-only. (S4-5, S4-2, S3-2) |
| D3 | Judge sandbox | Local Docker + cgroups worker behind `J.runBinary` interface (S4-12); document interim limits now (S1-7). |
| D4 | Email provider | SMTP client, provider-agnostic via env (`SMTP_URL`, `MAIL_FROM`). (S4-2) |
| D5 | USOS depth | Export-only CSV first. (S4-1) |
| D6 | Auth scope | scrypt now (S0-9); password reset + TOTP 2FA in Phase 4, once email exists. |
| D7 | Multipart uploads | Implement in Phase 4 (S4-6); fix spec text now (S4-10). |

---

## Phase 0 — Security & authorization `[blocker]`

- [x] **S0-1 Add role helpers.** `canManageProblem(me, problem)`, `canManageContest(me, contest)` in `server.js`, reusing `contestRole()`. `[S]`
- [x] **S0-2 Gate problem mutations.** `PATCH /api/problems/:id` (server.js:653), `POST /tests` (:670), `POST /clone` (:693), `POST /rejudge` (:700) → contest_admin/superadmin only. AC: student gets 403; admin 200. Negative tests. `[S]`
- [x] **S0-3 Gate contest mutations.** `members/csv` (:416), `duplicate` (:430), `news` + `subpages` POST (:617) → contest_admin only. Clarifications POST stays open to participants, add basic throttle. AC: 403 tests. `[S]`
- [x] **S0-4 Fix member reject.** `members/approve` must honor `approve:false` → remove from pending, never push to members (:393-414). Fix toast in `members/page.js:36`. AC: reject removes pending user; members unchanged. `[S]`
- [x] **S0-5 Protect tests read.** `GET /api/problems/:id/tests` (:665) → contest_admin/superadmin only. `[S]`
- [x] **S0-6 Stop verdict leak.** Strip `perTestFull` from all non-owner responses (submits list :731-735, detail :757-761); heatmap → admin only (:687); honor `verdictVisibility` per lifecycle. AC: during running ICPC with `first-failed`, another user sees only first failed. `[M]`
- [x] **S0-7 Grade privacy.** Require auth; allow self / own team / contest_admin; `?user=` only for admins (:537-539). AC: cross-user 403. `[S]`
- [x] **S0-8 Contain sample-run.** Judge samples-only path in `judgeOne`; enforce `settings.allowSampleRun`; never store `perTestFull` for `sampleOnly`. AC: sample run returns sample verdicts only. `[S]`
- [x] **S0-9 Auth hardening.** Switch to `crypto.scrypt` (keep verifying legacy `sha256$` rows, rehash on login); in-memory login throttle (per login+IP, e.g. 10/15 min); refuse to boot with default JWT secret when `NODE_ENV=production`. AC: throttle test + legacy-hash migration test. `[M]`

> ✅ Phase 0 completed 2026-10-17 — `tests/security.test.js` (10 tests) added; full suite 44/44 green.

**Phase 0 done =** all listed routes return 403 for unauthorized callers; tests suites cover them; a stranger account can no longer read tests, verdicts, grades, or mutate content.

---

## Phase 1 — Judge truth `[blocker for real contests]`

- [x] **S1-1 Language runners per D1.** Real runners for Java/Rust/JavaScript in `packages/judge/src/runners.js` (javac/java, rustc, node), wired through `prepareExec`; matrix trimmed to 6 languages; SQL/CUDA → 422 `LANG_OFF`; `/api/languages` reports per-language `available`. Toolchain missing → simulate, flagged `simulated: true` + explain. AC met: hello-world per available language in `tests/phase1.test.js`. `[L]`
- [x] **S1-2 Subtask/group scoring.** Per-test points = `group.points / cases_in_group`; IOI score sums groups. AC met: groups 10/20 → 10 on partial pass (per-group verdict table deferred to S3-1 cockpit); covered by `tests/manage.test.js`. `[M]`
- [x] **S1-3 LABS board correctness.** `computeLabsGrade` is the single source used by both `/grade` and the LABS board: weights, `bestOfK`/`dropWorstN`, late policy now honored on the board. AC met: board total == `/grade` total (weighted 2:1 case) in `tests/phase1.test.js`. `[M]`
- [x] **S1-4 Honest per-test stats.** `memMb` is `null` on submits and absent per test (no fabrication); per-test `timeMs` is measured wall time; `cpuMs` is the real sum; `-TRIGGER` fixtures are labeled as fixtures. AC met: greps/tests assert no invented numbers (`tests/phase1.test.js`). `[S]`
- [x] **S1-5 Duplicate copies everything.** Copy `testGroups`/`testCases`, setless problems, `news`. Done: setless problems now copied too (not only set-scoped); clone judges end-to-end (`tests/manage.test.js`). `[S]`
- [x] **S1-6 Enforce visibility + lifecycle on submit.** Block submits to `draft`/`quarantined` problems (non-admin) and before contest start; single-problem GET hidden; list filters to visible for non-admins, admins keep `?all=1`. AC met: negative tests per case in `tests/manage.test.js`. `[M]`
- [x] **S1-7 Interim runner hardening.** `packages/judge/src/run.js` is the single choke point: 1 MB output cap → RE, scrubbed env, temp cwd, `SIGKILL` on timeout. Gaps (memory, network, process tree, fs isolation) documented honestly in `docs/JUDGE_SANDBOX.md`; full isolation = S4-12. AC met: cap test + doc check in `tests/phase1.test.js`. `[S]`

> ✅ Phase 1 completed 2026-10-17 — S1-1…S1-7 done; `tests/phase1.test.js` (6 tests); full suite 55/55 green. Dev box toolchains: C/C++17/Python/Java/JS real; Rust runner ships but was toolchain-skipped here — verify on the judge host in S4-12.

> ✅ M1 slice completed 2026-10-17 — S1-2/S1-5/S1-6 + S2-1/S2-2 done; `tests/manage.test.js` (5 tests); full suite 49/49 green.

> ✅ M2 "Real courses" completed 2026-10-17 — S2-4/S2-5/S2-6 + S3-7/S3-9 + S4-1 (+ Phase 1 slice earlier); `tests/m2.test.js` (7 tests); full suite 62/62 green.

> ✅ M3 "Public contests" complete 2026-10-17 — S2-7, S2-8, S2-9, S3-1..S3-6, S3-8, S3-10, S3-11 (`tests/m3.test.js` 6 + `tests/m4.test.js` 3 + `tests/m5.test.js` 6 + `tests/m6.test.js` 2); full suite 79/79 green. Phase 4 remaining: S4-3 (lifecycle automation), S4-12 (Docker sandbox).

**Phase 1 done =** every language in the matrix really runs; IOI/LABS scores correct; cloned contests judge; no fabricated judge data; cheating via drafts/quarantine blocked.

---

## Phase 2 — Dead UI ↔ API (make or remove) `[high]`

- [x] **S2-1 DELETE batch.** Routes live: `problems/:id` (cascades groups+cases+notes), `tests/:gid` (id or name), `contests/:id` (archive-first, second call purges), `members/:uid`, `news/:id`, `webhooks/:id` (contest-scoped), `notes/:id`. Wired: ProblemEditor (calls existed), members page (Remove), manage overview (Delete permanently after archive), announcements (Delete), webhooks (Delete). Contest webhooks page also gained register/list/ping against new routes; deliveries list stays empty until S2-7. `[M]`
- [x] **S2-2 Notifications.** `GET/POST /api/notifications/prefs` (persisted on user), `POST /api/notifications/read`. Fake success paths removed from `NotificationsInbox.js` (failures now surface as toasts). `[S]`
- [ ] **S2-3 limitHistory + versions read.** `GET /api/problems/:id/limitHistory` (admins); store problem snapshots on PATCH for version diff. AC: editor panels render. `[M]`
- [x] **S2-4 Grade preview + feedback.** `POST /contests/:id/grade/preview` (what-if overrides: bestOfK, dropWorstN, penalty kind/value, grace, cap, floor; optional weights map + student login; no persist) and `POST /grade/feedback` (filter = status or problem code, notifies matched students). Grade page panel now renders applied overrides + student/class rows. AC met: preview default == `/grade` (test). `[M]`
- [x] **S2-5 Wire integrity.** Routes live (contest_admin only): `GET integrity/similarity?threshold` (pairs incl. logins + codeA/codeB for DiffView, last 200 submits), `GET integrity/timeline` (flags with human text), `GET integrity/appeals` (open list), `POST integrity/appeals/:id` (resolve → leaves open list). Web page uses real data; fake "not available yet" toasts removed. `[M]`
- [x] **S2-6 Exam single schema.** Canonical `settings.exam = {fullscreen, pasteBlock, shuffle, ipAllow, timeWindow}`; `GET/PATCH /contests/:id/exam` (members read, admins write); legacy `ips`/`tokens` mapped in both directions (patch wins — precedence bug caught by tests); violations log `GET/POST /exam/violations`; ExamGuard posts `paste`/`fullscreen-denied` violations and reads canonical keys; integrity page + settings page use the one schema. AC met: guard activates on real settings, one schema everywhere. `[M]`
- [x] **S2-7 Real webhook delivery.** `fireWebhooks` now does a real HTTP POST (`X-Satori-Event` header, JSON body `{event, at, payload}`) with a timeout, 3 retries with exponential backoff (env-tunable: `SATORI_WEBHOOK_*`), per-contest hook scoping, and a `deliveries` collection (pruned to last 300) behind `GET /webhooks/deliveries` (admin-only, newest first). `ping` performs a real request and reports status/attempts; webhooks page renders ✓/✗ with retry count. Wired: `submit.judged` (incl. CE paths — gap found by test and fixed), `rejudge.done` (fires after the queue drains), `limit.changed` (payload carries contestId + new limits). AC met: positive + retry-exhaustion + post-drain tests. `[M]`
- [x] **S2-8 Export + list fixes.** `ranking.csv` now real: rank, contestant, one cell per problem (text) + total, built from the shared `buildRanking` (JSON `ranking` route refactored onto it — no drift). `archived` accepts `yes|Yes|true|1` (web sends lowercase `yes`, previously ignored → toggle did nothing). `role=other` = not-member-and-not-pending. AC met: CSV downloads with per-problem cells (test). `[S]`
- [x] **S2-9 Member roles.** `POST /contests/:id/members {login, role}` — participant → members, teacher/jury → admins (+membership), idempotent, 404 unknown login, 422 bad role, 403 non-admins; members page add-role panel real (fake "not available yet" toast gone). AC met: granted teacher can manage the contest (test). `[S]`
- [x] **S2-10 Filter fixes.** `approveAllByFilter` honors `q` (:403-405); CSV import returns `{unknown:[...]}` (`members/page.js:57`). Done early with S0-3/S0-4 (server + web toast already wired). `[S]`

---

## Phase 3 — Wrong behavior fixes `[medium-high]`

- [x] **S3-1 Contract sweep (server side).** Problems list now returns `_score` (caller best points), `solvesPct`, resolved `alias`, `setter` (creator login, stored as `setterId`), `group` (set name); submits carry `limitMs`/`limitMb`, per-test `group` + `points`, and top-level `expected`/`got` from the first failing test (gated by `verdictVisibility` while running); teammates see team submits and rows carry `members`; ranking payload carries `me` (rank + total), `penaltyMin` (canonical `settings.penaltyMin`), `unfreezeAt` (freeze → endAt), and honors `settings.board.mode` — `hidden` → 403 `BOARD_HIDDEN` for non-admins on ranking, CSV and live SSE; rankings/live pushes real row snapshots; SSE `phase` strings are canonical (`QUE`/`CMP`/`TST`/verdict — misaligned `testing i/n` push removed); notes `problemId` + submit `b.lang` already aligned; submit accepts `b.lang || b.language`. Ranking page shows "Your standing". Covers: contract, hidden-detail negative, ranking gate, teammate tests. `[M]`
- [x] **S3-2 Results page truth.** "Best first" = verdict quality order (OK → in-progress → WA/TLE/MLE/RE/CE, newest first within a rank); `team` filter applied server-side on `/api/submits`; download replaced by `GET /api/submits/codes.zip` — your own codes bundled with a stdlib-only store-ZIP writer (`lib/zip.js`, no new deps, honest 404 when nothing matches); "needs jszip" fake and 50-fetch loop gone. `[S]`
- [x] **S3-3 bulk-extend complete.** Shifts contest `startAt`/`endAt`/`freezeAt` + `settings.defaultDeadline` + explicit problem- and set-level `deadlineAt` (no longer materializes defaults onto problems). AC met: default-policy contest shifts (test), 403 for students, 422 for zero days. `[S]`
- [x] **S3-4 ICS always useful.** `grade.ics` emits problem deadlines from the effective-deadline chain (problem → set → contest default → endAt) even with `deadlinePolicy` disabled, plus start/end/freeze events; text escaped per RFC 5545. `[S]`
- [x] **S3-5 Status honesty.** `/api/status` returns real language availability + missing toolchains, worker label `local-spawn`, ETA labelled as estimate, explicit sandbox-gap line; status page shows languages/missing-toolchains and the sandbox note instead of fake worker images. `[S]`
- [x] **S3-6 Home cockpit.** Dropped the never-rendered grade fetch; `solvesPct` now real on the problems list (unique accepted solvers / members, computed server-side) feeding "recommended"; streak/accepted exclude `sampleOnly`. AC met: solvesPct 100/0 test. `[S]`
- [x] **S3-7 Me page real data.** `/api/me` carries `sessions` + `teams`; `GET /api/me/sessions` (current flagged), `DELETE /api/me/sessions/:jti` (per device — revoked token now 401), `GET /api/me/teams` (teams store), `POST /api/me/password` (old+new per D6, revokes other sessions). Me page: per-device Revoke, signed-in time, real password form. AC met: revoke kills that device only (test). `[M]`
- [x] **S3-8 i18n pass.** Server explainers in request lang (Accept-Language / `?lang=`; judge stores `explainKey`+`explainArgs`, serve-time localizes, keys stripped from JSON); language toggle reloads (guaranteed re-render + hydration-safe `useLang`); STR dict pruned 120→91 keys (script-verified: every entry used, zero stale refs); ShellControls/ExamGuard/integrity page hardcoded strings localized; `tests/m6.test.js` (2). `[M]`
- [x] **S3-9 Grade matrix completeness.** `GET /api/submits` supports `offset` with `limit` (max 1000) and returns `total`; grade page pages at 500 until total (cap 20k), no silent 200 cap. AC met: pagination test. `[S]`
- [x] **S3-10 CmdK.** "New submit (recent contest)" resolves the recent contest's problems and jumps to the first problem's submit page; falls back to the contest page when there is nothing to submit. `[S]`
- [x] **S3-11 ProblemEditor checker.** New cases inherit the group's checker instead of hardcoded `token` (server already persists `case.checker`; regression test pins group→case inheritance). `[S]`

---

## Phase 4 — Missing features (proposal P1/P2) `[medium]`

- [x] **S4-1 USOS/grade export.** `GET /contests/:id/grade/export.csv` (admin): `login,usos_id,first_name,last_name,email,total,pct,grade,<problem codes>` computed via the shared `computeLabsGrade`; configurable `?scale=pct:grade,...` (default 50:3, 75:4, 90:5). Grade page exports server CSV with a scale input. AC met: total matches `/grade`, custom scale honoured, student 403. `[M]`
- [ ] **S4-2 Email.** Provider per D4; outbox + templates; wire announcements (`email:true`), approvals, invites, deadline reminders (needs S4-3). `[M]`
- [ ] **S4-3 Lifecycle automation.** Minute scheduler: `draft→registration→running→finished` by `startAt`/`endAt`; auto-freeze at `freezeAt`; `?unfrozen=1` replay view + `_unfrozenView` (ranking.js:129); optional replay scrubber. `[L]`
- [ ] **S4-4 Teams.** Invite/accept, roster edit, substitutes, submit→team resolution, scoreboard merge + member expand. `[L]`
- [ ] **S4-5 Importer: Polygon ZIP.** Real unzip + `problem.xml` + tests + statement (D2 dependency). Athina PDF: decide (likely "legacy, skip" + remove claims). `[L]`
- [ ] **S4-6 Uploads/attachments.** Announcement attachments + problem PDF upload; storage dir, size/type guard, previews. Enables S4-8 PDFs. `[M]`
- [ ] **S4-7 PWA real.** Register SW at correct path (public dir), unify outbox stores (`outbox.js` vs `sw.js`), queue-submit integration, fix manifest path + icons, auth-safe caching. `[M]`
- [ ] **S4-8 Editorial + EN statements.** Add `editorialMd`, `statementMdEn` to model + API + UI (`problems/[pid]/page.js:48-147`). `[M]`
- [ ] **S4-9 CLI/SDK.** `pdf` + `watch` commands or remove from help; `--token` flag; refresh-token persistence + auto-refresh; fix `problems` without `--contest`; SDK parity (refresh, SSE, results). `[M]`
- [ ] **S4-10 openapi.yaml truth.** Document all server routes (or generate); fix multipart/gist claim (per D7); fix `role=other`; add announcement search or fix spec; keep fallback `openapi()` in sync. `[M]`
- [ ] **S4-11 v1.js redirect map.** Persist mapping, serve real 302 + Location (:800). `[S]`
- [ ] **S4-12 Sandboxed runner (D3).** Docker/cgroups or Kolejka adapter behind `J.runBinary`. `[L]`

---

## Phase 5 — Hygiene `[small]`

- [ ] **S5-1 Tests.** Add: auth refresh/revoke/legacy-hash; apply/approve/reject (incl. S0-4 regression); members csv 403; deadline resolution; grade vs board parity; duplicate incl. tests; rejudge authz; SSE smoke; notifications/notes round-trip; sample-run containment. `[M]`
- [ ] **S5-2 Seeds.** Add clarifications, one webhook, sample notifications. `[S]`
- [ ] **S5-3 Cleanup.** Remove empty dirs (`apps/api/src/routes/`, `apps/cli/lib/`); dead code (`useApi.js`, duplicate outbox, `preview-eyebrow` dev route, `tokens.css` compat aliases, unused i18n keys); remove `sw.js` from `app/` (S4-7). `[S]`
- [ ] **S5-4 Docs align.** README claims (importers count, CLI examples), `docs/API.md`, `docs/FRONTEND_SPEC.md` — mark done features, strike promises not implemented yet. `[S]`

---

## Milestones

| Milestone | Contents | Meaning |
|-----------|----------|---------|
| M1 "Safe demo" ✅ | Phase 0 + S1-2, S1-5, S1-6 + S2-1, S2-2 | No security holes; tests private; deletes work — 2026-10-17 |
| M2 "Real courses" ✅ | Rest of Phase 1 + S2-4, S2-5, S2-6 + S3-7, S3-9 + S4-1 | Labs/grading credible; USOS export; exam controls real — 2026-10-17 |
| M3 "Public contests" | S2-7, S2-8 + S3 sweep + S4-3 + S4-12 | Scoreboard/webhooks/CSV real; sandboxed judge |
| M4 "Polish" | Rest of Phase 4 + Phase 5 | Parity with proposal P1/P2 claims |

## Out of scope (deliberate)

- WebSocket upgrade (SSE is adequate; proposal's "REST + WS" claim softened in docs).
- Git-push authoring (proposal marked it a "dream").
- Full Kolejka grid integration — only the adapter interface (S4-12).
