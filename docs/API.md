# Satori V2 docs

## API
- Base `http://localhost:3001`. Auth `Authorization: Bearer <JWT>`.
- `POST /api/auth/register` `{login,email,password,firstName,lastName,accessCode?}`
- `POST /api/auth/token` `{login,password,device?}` -> `{token,refresh}`
- `GET /api/contests?role=joined|pending|managed&q&archived=Yes`
- `POST /api/contests/:id/apply` (open=joined, approval=pending)
- `POST /api/contests/:id/members/approve` `{userIds}|{approveAllByFilter}` + `POST .../members/csv` `{csv}`
- `GET /api/contests/:id/problems?q&status=all|solved|todo&tag=` — each row has `_best` chip + `_tries` + `effectiveDeadline/deadlineSource/deadlinePolicy` (null when disabled)
- `GET /api/problems/:id` — includes `effectiveDeadline/deadlineSource/deadlinePolicy`. `PATCH` accepts `{deadlineAt}`.
- `PATCH /api/contests/:id` — accepts `{settings:{deadlinePolicy:{enabled,lateMode:soft|hard,penaltyKind:perDay|perHour|percent,penaltyValue,graceMin,capZeroAfterDays}, defaultDeadline}}`.
- `POST /api/contests/:id/deadlines/bulk-extend` `{days}` — shifts problem deadlines (teacher bulk extend).
- `POST /api/problems/:id/submit` `{code,filename,lang?}` — row-modal path, no redirect
- `POST /api/submits` same shape. `POST /api/submits/sample-run` no penalty.
- `GET /api/submits/:id/events` SSE `queued→compiling→testing t3/12→judged`
- `GET /api/contests/:id/ranking?mode=ICPC|IOI` + `GET .../rankings/live` SSE
- Ranking honors deadlines when `deadlinePolicy.enabled`: ICPC hard excludes late, soft marks `†`; IOI/LABS penalize (`perDay/perHour/percent`) with grace + cap.
- `POST /api/submits` rejects `409 LATE` on hard deadlines (sample-run bypasses). Late soft submits store `isLate/lateUnits`.
- `GET /api/contests/:id/grade?user=` what-if projection. `GET .../grade.ics` calendar.
- `POST /api/webhooks` `{url,events}` — `submit.judged`, `rejudge.done`, `limit.changed`
- V1 redirects: `/contest/<cid>/`, `/contest/<cid>/problems/<pid>`, `/contest/<cid>/ranking/<rid>`, `/contest/<cid>/results`, `/subpage/<sid>`

## Filename rule (no silent fail)
- Allowed `^[A-Za-z0-9][A-Za-z0-9._-]*$`. Else `422 FILENAME_CHARSET` + `suggestion`.
- Example: `my solution (1).cpp` -> `my_solution_1.cpp`

## Judge
- `packages/judge/src/judge.js`: queue, `simulate()`, checkers `token|float|custom`.
- Prod: swap `simulate()` with Docker `kolejka/satori:{judge,extended,cuda}` + cgroups v2.
- Limits: per-problem `limits{timeMs,memoryMb,stackMb,perLang{Python}}`. Changes logged to `limitHistory`.
- Verdicts: `QUE|CMP|TST|OK|ANS|WA|TLE|MLE|RE|CE`. `ANS` counts as accepted (V1 compat).
- Triggers for tests: code contains `WA-TRIGGER|TLE-TRIGGER|MLE-TRIGGER|RE-TRIGGER|CE-TRIGGER`.

## Teacher
- Duplicate contest: `POST /api/contests/:id/duplicate` (clone UZI 2025->2026).
- Rejudge: `POST /api/problems/:id/rejudge`, single: `POST /api/submits/:id/rejudge`.
- Heatmap: `GET /api/problems/:id/heatmap`. Audit: `GET /api/contests/:id/audit`.
- Quarantine buggy: `PATCH /api/problems/:id {visibility:quarantined}`.
- Alias letters: `PATCH /api/problems/:id {aliasLetters:{<contestId>:"A"}}`.
- USOS: CSV import + grade export shape matches BaCa2 (`members/csv`, `grade`).

## Exam / integrity
- Contest `settings.exam={fullscreen:true,pasteBlock:true,ipAllow:[],shuffle:true,windowToken}` enforced client-side.
- `lib/integrity.js`: `similarityGraph()` (shingle Jaccard, threshold 0.6/0.85) + `timelineFlags()`. Jury-only view.

## Migration
- `node importers/v1.js v1 ./dump.json` — V1 contests->archived, problems tagged `imported:v1`.
- `node importers/v1.js polygon pkg.zip` — Polygon ZIP stub (wire unzip in prod).
- Archive: keep `/contest/<id>/problems/<pid>` URLs via redirect map (CLI comments safe).
