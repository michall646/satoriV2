# Satori V2 API

Canonical machine-readable spec: `openapi.yaml` (OpenAPI 3.1).
Base URL: `http://localhost:3001` unless `SATORI_API` / deployment rewrites say otherwise.
Auth: `Authorization: Bearer <JWT>` from `POST /api/auth/token`.

Every reject is `{ "error": { "code", "message", "hint", "field"? } }`. `field` is
present when the failure belongs to one input. The web client surfaces `message` and
`hint`; do not render the raw status line.

## Auth and profile

- `POST /api/auth/register` `{login,email,password,firstName?,lastName?,accessCode?,affiliationOrgId?}`
  -> `201 {id,login}`. Login is 3–24 chars `[a-z0-9_]`; password is 6+ chars.
- `POST /api/auth/token` `{login,password,device?}` -> `{token,refresh,expiresIn:43200,tokenType:"Bearer"}`.
  JWT lifetime 12 h; refresh token 14 d. Ten bad logins per login+IP are throttled for 15 min.
- `POST /api/auth/refresh` `{refresh}` -> `{token,expiresIn}`. Returns 401 `BAD_REFRESH`/`REVOKED`.
- `POST /api/auth/revoke` `{jti?}` -> `{ok:true}`. Without `jti` it revokes all sessions of the caller.
- `GET /api/me` -> profile plus `sessions` (current flagged) and `teams`.
- `PATCH /api/me` accepts only `firstName`, `lastName`, `email`, `affiliationOrgId`.
- `GET /api/me/sessions`; `DELETE /api/me/sessions/:jti`; `GET /api/me/teams`.
- `POST /api/me/password` `{old,new}` -> revokes every other session and reports `revokedOthers`.

`usosId` is a user field consumed by the grade CSV (`usos_id`). There is **no API write
route for it yet** (tracked as B4); registration does not accept it.

## Contests, members, teams

- `GET /api/contests?role=joined|pending|managed|other&q=&archived=yes|true|1`
  -> `{items,total}`. Without `archived` archived contests are hidden.
- `POST /api/contests` creates a draft. `mode` (ICPC|IOI|LABS|EXAM|PLAYGROUND|VIRTUAL)
  and `template` are stored; `endAt` is the canonical end time.
- `GET /api/contests/:id` returns the public projection unless the caller is a contest
  admin: `members`, `pending`, `admins` and `settings.exam` are removed and replaced by
  `memberCount`. `PATCH` and `DELETE` are contest-admin/superadmin.
  First `DELETE` archives, second purges problems, tests, teams, news, subpages and clarifications.
- `POST /api/contests/:id/apply` -> open registration joins, approval mode creates a pending row.
- `GET|POST /api/contests/:id/members` (admins). `GET` rows include `role`
  (`participant|teacher|jury`) and pending rows report `pending`. `POST {login,role}`;
  teacher/jury are added to `members` and `admins`, and demoting to `participant`
  removes the admin grant.
- `POST /api/contests/:id/members/approve` `{userIds|userId,approve?,approveAllByFilter?,q?}`.
  `approve:false` rejects; `approveAllByFilter:true` approves pending users matching `q`.
- `POST /api/contests/:id/members/csv` `{csv}` -> `{added,unknown}`.
- `DELETE /api/contests/:id/members/:uid` removes member, pending and admin grants
  and returns `revokedAdmin`.
- `POST /api/contests/:id/duplicate` clones sets, problems, tests and news.
- `GET|POST /api/contests/:id/teams`. Creation accepts `{name,memberIds?,loginIdentity?,scoreboardName?}`.
  The store currently writes `memberIds`; `members` is the planned canonical field (D5).
- `POST /api/contests/:id/deadlines/bulk-extend` `{days}` shifts start/end/freeze,
  `settings.defaultDeadline`, and explicit set/problem deadlines. Zero/invalid days -> 422.
- `GET /api/contests/:id/audit` returns audit rows whose target mentions the contest.
  It currently requires only a login, not contest-admin.

## Problems and tests

- `GET /api/contests/:id/problems?q=&status=all|solved|todo&tag=` returns
  `{sets,items,deadlinePolicy}`. Each row includes `_best`, `_tries`, `_score`,
  `solvesPct`, resolved `alias`, `setter`, `group`, `effectiveDeadline`,
  `deadlineSource`, `deadlinePolicy`.
- `POST /api/contests/:id/problems` (admins) `{name,code?,setId?,statementMd?,limits?,visibility?,tags?,deadlineAt?}`.
  Default visibility is `draft`; default limits are `{timeMs:1000,memoryMb:256,stackMb:64,perLang:{}}`.
- `GET /api/problems/:id` includes the enriched deadline fields. `PATCH` (admins) versions
  limit changes into `limitHistory` and fires `limit.changed`. `DELETE` cascades tests and notes.
- `GET|POST /api/problems/:id/tests` (admins). `POST {group:{...}}` or `{case:{...}}`.
  `DELETE /api/problems/:id/tests/:groupId` accepts a group id or name.
- `GET /api/problems/:id/best` -> `{best,tries,last}` for the caller.
- `GET /api/problems/:id/heatmap` -> `{fails:{testNumber:count}}` (admins).
- `POST /api/problems/:id/clone` `{contestId?,code?}` (admins).
- `POST /api/problems/:id/rejudge` requeues all non-sample submits (admins).
- `POST /api/problems/:id/submit` is an alias for submit with `contestId` preset.

### Limits

- `limits.perLang[lang]` is an **absolute millisecond limit**, not a multiplier.
  Canonical keys: `C`, `C++17`, `Java`, `Python`, `Rust`, `JavaScript`.
- Judge resolution: per-case `timeMs`, then `limits.perLang[lang]`, then `limits.timeMs`.
  The runner clamps to 100–120000 ms (2 s default) and reports `limitClamped` when adjusted.
- `timeMult` on the language matrix is display-only legacy metadata; it is not a judge limit.

## Submissions

- `POST /api/submits` accepts **JSON only**:
  `{problemId,contestId?,code|source,filename?,lang|language?,teamId?,sampleOnly?}`.
  Multipart upload and gist import do **not** exist. Code is limited to 512 KB.
  `filename` defaults to `solution.cpp`; the safe pattern is `^[A-Za-z0-9][A-Za-z0-9._-]*$`,
  otherwise 422 `FILENAME_CHARSET` plus a `suggestion`. Language is inferred from the
  extension unless `lang`/`language` overrides it.
- Access: `problemId` must belong to the supplied `contestId` (403 `CONTEST_MISMATCH`).
  `private`/`exam` contests and contests whose `mode` is `EXAM` require membership.
  A contest `endAt` in the past returns 409 `ENDED` unless `mode=PLAYGROUND` or
  `settings.upsolve`/`settings.allowUpsolve`/`contest.upsolve` is set; sample runs
  bypass the end check.
  `teamId` must exist, belong to the same contest and include the caller.
  Submits are rate-limited per user (429 with `retryAfterSec`).
- `POST /api/submits/sample-run` uses the same body with `sampleOnly` forced. It does not
  score and does not produce late penalties; 409 `SAMPLE_OFF` when the contest disables runs.
- `GET /api/submits?contest=&problem=&verdict=&me=&team=&limit=&offset=` returns
  `{items,total,limit,offset}`. Default limit 50, **maximum 1000** (values above are clamped).
  A contest's board mode applies here too: `hidden` -> 403 `BOARD_HIDDEN` for non-managers,
  `me-only` -> 403 `BOARD_ME_ONLY` for anonymous callers and only the caller's rows otherwise.
- Detail: `GET /api/submits/:id`. Owners/admins receive `code`, `perTest`, `perTestFull`
  and compile details; other callers receive only verdict/time/points/lang/timestamps
  (no code, compileLog, per-test detail, expected or got). `verdictVisibility` can trim
  `perTest` while a contest is running.
- `GET /api/submits/:id/events` is SSE: `QUE -> CMP -> TST -> verdict` with `phase`,
  `testsDone/testsTotal` and queue position events.
- `POST /api/submits/:id/rejudge` requeues one submit. It requires a login and
  problem-manager rights; stale judge output is cleared before requeueing.
- `GET /api/submits/codes.zip?contest=&problem=` returns a ZIP of the caller's own
  submissions (max 100) or 404 `NO_CODES`.

## Ranking

- `GET /api/contests/:id/ranking` -> `{contestMode,mode,problems,rows,me,penaltyMin,deadlines,deadlinePolicy,freezeAt,unfreezeAt}`.
- Mode resolution: `scoreboardMode` is canonical, with `contest.mode` as fallback.
  `EXAM`/`TAKEHOME`/`PLAYGROUND`/`IOI` use IOI; `LABS`/`COURSE` use LABS;
  `ICPC`/`VIRTUAL`/blank use ICPC. `?mode` is accepted but **ignored** by the route
  today; pass the mode in contest settings instead (B2 route wiring).
- `teams` are used only when `contest.teamMode === true`; legacy team rows never replace
  the individual board. Teachers/jury are not ranked.
- Freeze: when `freezeAt` is set, submits after it are hidden until
  `settings.unfreezeAt || endAt`; the response includes `frozen` and `unfreezeAt`.
  There is no `?unfrozen` request parameter yet (B3); the replay flag is server-side
  only (`unfrozenView` / `_unfrozenView` in tests).
- `GET /api/contests/:id/ranking.csv` returns rank, contestant, per-problem cells and total.
- `GET /api/contests/:id/rankings/live` streams the same rows over SSE every 15 s and
  re-checks board visibility on every tick.
- `settings.board.mode === "hidden"` returns 403 `BOARD_HIDDEN` to non-managers on
  ranking, CSV and live. `me-only` filters ranking/CSV/live rows to the caller;
  `/api/submits` returns 403 `BOARD_ME_ONLY` for anonymous callers and only the caller's
  rows otherwise.

## Grades

- `GET /api/contests/:id/grade?user=` returns `{...out,deadlines,deadlinePolicy,submittedAt}`
  where `out` has `total`, `grade`, `detail`. Allowed for self, a contest manager, or a
  teammate.
- `GET /api/contests/:id/grade/matrix` (admins) returns
  `{contestId,mode,scale,problems,rows,summary}`; every row total/grade comes from the
  same `computeLabsGrade` as the student page and CSV. Teachers/jury are excluded.
- `GET /api/contests/:id/grade/analytics` (admins) returns the distribution, at-risk
  students, per-problem quality (attempts, solve rate, first blood) and summary.
- `POST /api/contests/:id/grade/preview` (admins) computes a what-if over the whole
  cohort without persisting. Body may override `bestOfK`, `dropWorstN`, `penaltyKind`,
  `latePenalty`, `graceMin`, `capZeroAfterDays`, `floorPct`, `weights` and select a
  `login`/`student`/`previewStudent`. Response: `{applied,scale,rows,student,summary}`.
- `POST /api/contests/:id/grade/feedback` (admins) `{text,filter?}` notifies matched
  students. `filter` is a problem code or verdict (not a problem name).
- `GET /api/contests/:id/grade/export.csv?scale=90:5,75:4,50:3,0:2` (admins) returns
  UTF-8 BOM + CRLF CSV with
  `login,usos_id,first_name,last_name,email,total,pct,grade,<problem codes>`.
  `usos_id` comes from `user.usosId`; until B4 adds a write route the column is usually empty.
  `pct` currently mirrors `total`. The grade uses `settings.gradeScale`; `?scale=`
  overrides it for that export only.
- `GET /api/contests/:id/grade.ics` returns the contest calendar (problem deadlines,
  start, end, freeze) as `text/calendar`. It is a calendar export, not a grade export.

## Exams, integrity, comms

- Exam settings are `settings.exam = {fullscreen,pasteBlock,shuffle,ipAllow,timeWindow}`.
  `GET|PATCH /api/contests/:id/exam` (members read, admins write). `ipAllow` and
  `timeWindow` are free-text strings; `timeWindow` is a label such as `10:00-12:00`,
  not a parsed range. Both are enforced by `ExamGuard` on the client; server-side
  IP/window enforcement is tracked as F3.
- `GET|POST /api/contests/:id/exam/violations`: students append
  `{type,detail}`, admins list rows.
- `GET /api/contests/:id/integrity/similarity?threshold=0.6`, `/timeline`, `/appeals`
  (admins); `POST /integrity/appeals/:id` resolves one.
- `GET|POST /api/contests/:id/clarifications`, `/news`, `/subpages`.
  Clarification GET rows include `mine`; writing a clarification requires contest
  membership and accepts only `question` (or `text`) plus an optional `problem` that must
  belong to the contest. `POST .../clarifications/:cid/answer {answer}` is the jury
  answer route and notifies the asker.
  News/subpages writes require contest admin and whitelist their fields.
- `DELETE /api/contests/:id/{clarifications|news|subpages}/:id` (admins).

## Webhooks and notifications

- Contest-scoped: `GET|POST /api/contests/:id/webhooks`,
  `GET .../webhooks/deliveries` (last 50), `POST .../webhooks/:hookId/ping`,
  `DELETE .../webhooks/:hookId` (all admin-only).
- Global: `GET /api/webhooks` requires a login and returns only hooks the caller may
  see (contest admins see their contest hooks, superadmins see global hooks).
  `POST /api/webhooks` requires a login; a global hook requires superadmin, a
  contest-scoped hook requires that contest's admin. URLs are SSRF-checked
  (http/https only, no loopback/private/link-local, no redirects).
- Events: `submit.judged`, `rejudge.done`, `limit.changed`. Delivery is JSON with
  `X-Satori-Event`, a 5 s timeout, 4 attempts with exponential backoff, DNS pinning at
  delivery time, and a delivery log pruned to the last 300 rows. When
  `SATORI_WEBHOOK_SECRET` is set, deliveries also carry
  `X-Satori-Signature: sha256=<hex HMAC>`. No signature header is sent without a secret.
- `GET /api/notifications` (last 50); `POST /api/notifications/read {ids}|{all:true}`;
  `GET|POST /api/notifications/prefs`.
- `GET|POST /api/notes` (`?problem=`, body `{problemId|problem,teamId?,text}`);
  `DELETE /api/notes/:id` (owner or superadmin).

## Meta, search, status

- `GET /api/health` -> `{ok,time,queue}`.
- `GET /api/status` -> queue, ETA estimate, worker label (`local-spawn`), real language
  availability, `missingToolchains`, maintenance and an explicit sandbox-gap string.
- `GET /api/languages` -> `{matrix:[{lang,version,flags,hello,available,timeMult?}]}` with
  the six canonical keys. `available` comes from real toolchain probes.
- `GET /api/search?q=` searches contests, problems and users. It does **not** search
  announcements yet.
- `GET /api/orgs` returns organizations.
- `GET /api/openapi.json` should return this document as JSON. The route currently
  reads `openapi.yaml` and serves it as `text/yaml`; converting it to JSON is a handoff
  to the API owner (`apps/api/src/routes/meta.js`). Until then, parse `openapi.yaml`
  or use a YAML parser.

## V1 compatibility routes

These exist so links embedded in old source comments keep working. They return JSON
descriptors `{v1,v2,...}`; they do **not** issue browser redirects.

- `/contest/:id` -> `{v1,v2:"/api/contests/:id",redirect:"/contests/:id"}`
- `/contest/:id/problems` -> 302 with `{v1,v2:"/api/contests/:id/problems"}` (JSON body)
- `/contest/:id/problems/:pid` -> `{v1,v2,problem}`
- `/contest/:id/ranking/:rid` -> `{v1,v2:"/api/contests/:id/ranking"}`
- `/contest/:id/results` -> `{v1,v2:"/api/submits?contest=:id"}`
- `/subpage/:id` -> `{v1,v2,subpage}`

## Judge

- Languages: C, C++17, Java, Python, Rust, JavaScript. SQL and CUDA are retired with
  422 `LANG_OFF`.
- C is compiled with `gcc` (`.c`, `-std=c17`); C++ with `g++` (`.cpp`, `-std=c++17`).
  A C submission is never compiled as C++.
- Checkers today:
  - `token`: whitespace-normalized exact match.
  - `float`: whitespace-separated numeric compare with `1e-6` tolerance.
  - `custom`: **currently legacy substring matching** on the first expected line.
    This does not satisfy D7. Tracked as C4.
- Planned custom-checker contract (C4, not shipped): a checker program receives the
  test input, expected output and contestant output on stdin; exit 0 accepts, non-zero
  rejects, stderr becomes the WA message; it is compiled once and runs under the same
  timeout/sandbox as the submission.
- Verdicts: `QUE|CMP|TST|OK|ANS|WA|TLE|MLE|RE|CE`; `ANS` counts as accepted.
- Trigger fixtures (`WA-TRIGGER`, etc.) only fire in demo/test mode.
- See `docs/JUDGE_SANDBOX.md` for enforced limits and known gaps.

## Known gaps (tracked, do not document as shipped)

| Gap | Task |
|-----|------|
| `/api/openapi.json` serves YAML, not JSON | G1 handoff |
| `?mode` / `?unfrozen` are accepted but not wired into the ranking route | B2/B3 |
| No `usosId` write route | B4 |
| `custom` checker is substring, not a program | C4 |
| Exam `ipAllow`/`timeWindow` are client-enforced only | F3 |
| Welcome email / password reset / 2FA not shipped | G5 |

## Filename rule (no silent fail)

- Allowed `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Otherwise `422 FILENAME_CHARSET` with a
  `suggestion`.
- Example: `my solution (1).cpp` -> `my_solution_1.cpp`.

## Migration

- `node importers/v1.js v1 ./dump.json` — V1 contests become archived, problems tagged `imported:v1`.
- `node importers/v1.js polygon pkg.zip` — Polygon ZIP stub; real unzip is tracked as S4-5.
- Archive keeps `/contest/<id>/problems/<pid>` reachable through the JSON descriptor routes above.
