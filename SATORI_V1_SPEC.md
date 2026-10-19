# Satori V1 — Extensive System Specification

> Source: live investigation of https://satori.tcs.uj.edu.pl/ (Sept 2026), MIT source mirrors, community CLIs, theses, Kolejka/BaCa2 docs.
> Scope: full system — judge + contest/problem hosting + users/roles + results/ranking + admin/ops.
> Language: English. Status: V1 in production but upstream abandoned.

---

## 1. What Satori Is

**Satori Testing System** is a free (MIT) online judge + course/contest manager built by Theoretical Computer Science, Jagiellonian University (Bartosz Walczak, Grzegorz Gutowski, Grzegorz Herman, Lech Duraj, Kamil Kraszewski, Marek Wróbel et al., funded by European Social Fund in Poland).

Two jobs in one product:

1. **Online judge** — accept source files, compile/run on hidden tests, return verdicts.
2. **Contest/course hosting** — `Contest` is the universal container. Used for:
   - ICPC-style contests — `UZI` (Uniwersyteckie Zawody Informatyczne, 3×/year, individual winter/spring, 3-person teams autumn, eliminations to AMP/ICPC).
   - Open practice — `Satori Playground` (contest 251519, old UZI tasks, anyone with affiliation can apply).
   - University courses — e.g. `Rust, 2023/24` (contest 8677128) with `Labs 1..8` as subpages. Each subject = one contest.

Tagline from README: *"allows to run programming contests (ICPC style) and programming courses."*

History: Athina Playground (old) → Satori since 2011 → open-sourced 2013-12-10 (Bitbucket `satoriproject/satori`, now mirrors `zielmicha/satori`, `TFKls/satori-git` — 2,300+ commits, archived 2020) → judge backend migrated to **Kolejka** grid → upstream described by its own maintainers as *"abandoned and not safe for use"* (quoted in `MasFlam/SatoriCLI.jl`), yet still the production system at TCS.

---

## 2. Actors & Access Model

| Actor | How obtained | What they do |
|---|---|---|
| Anonymous | none | View `/news`, `/contest/select` (name+description only), static `/subpage/3864210` (UZI info), `/register`, `/login`. Everything else redirects to login. |
| Registered user | `Login` 3–24 chars `[a-z0-9_]`, first/last name (real names enforced), e-mail, password + `Access code` field | Edit `User profile` incl. `Affiliation` (school/university, mandatory for Playground), `Select contest` → `Apply`, submit, view own results, view public rankings. |
| Contest member | Approved `Apply` by contest admin (manual clicking; Playground warns *"write e-mail, we don't check list regularly"*) | See contest news/problems/subpages/submit/results/ranking. |
| Contest admin / teacher | Granted out-of-band | Create problems/tests, manage members, post news/subpages, configure ranking, rejudge. |
| Global admin (TCS staff) | Server access | Create contests, manage judges/workers, set time/memory limits. |
| Team (UZI autumn) | Represented as single account `uj7 [Smolira, Bawołek, Salata]` | One login per 3-person team, one computer rule enforced socially, not technically. |

Key flows:

- **Register**: `/register` — login, access code, first/last, e-mail, password+confirm. No captcha observed, no SSO, no USOS link.
- **Login**: `/login?redir=...` — login+password, session cookie. Community CLIs confirm: *"no API, only cookie token, must re-enter password when token expires"*; `satori-enhancements` adds *"maintain login between sessions"* because V1 drops it.
- **Select contest**: `/contest/select` — tables `Joined / Pending / Other`, `Show archived: No/Yes`, sort by Name/Description, `Apply` button per row. No search, separate page (extension replaces with popup).
- **Affiliation gate**: Playground FAQ requires `Affiliation` set + manual approval; *"don't apply to other contests (courses), you'll just be rejected = extra clicking for us."*

---

## 3. Site Map (Observed URLs)

```
/news                              — global news (3 posts: 2011 welcome, 2013 filename rule, 2013 open-source)
/register                          — registration form
/login?redir=...                   — login form
/contest/select                    — contest browser (?other_sort, _limit, _page, _order, _filter_archived)
/contest/<cid>/                    — contest home (= news list, e.g. /contest/251519/, /contest/8677128/)
/contest/<cid>/news                — same as home
/contest/<cid>/subpage/<sid>       — rich content pages (FAQ 275018, Labs 8802880..., UZI static 3864210)
/contest/<cid>/problems            — problem list grouped in ProblemSets (inferred from Koishi scraper)
/contest/<cid>/problems/<pid>      — single problem (dominik-korsa CLI embeds URL in source comment)
/contest/<cid>/results?results_limit=N — submit table (class="results")
/contest/<cid>/ranking/<rid>       — ICPC scoreboard (e.g. /contest/10193118/ranking/10206532)
/subpage/<sid>                     — global static pages (UZI info 3864210, compile options 184196 — login-walled)
/files/satori_banner.png           — header banner
/view/Subpage/<sid>/content_files/ — attachments (images, mailto png, PDFs)
```

No REST/GraphQL. All CLIs (`zielmicha/satori-cli`, `mhorod/satori-cli` Rust, `dominik-korsa/satori-cli` Rust, `MasFlam/SatoriCLI.jl` Julia, `cloud11665/koishi` Python + `satori-points`) **webscrape** `lxml` + `requests.Session`.

---

## 4. Contests

A contest = course OR competition. Fields: `id (numeric, e.g. 251519, 8677128, 10193118), name, description, status (all|managed|joined|pending|other per SatoriCLI.jl), archived flag`.

Features:

- **News**: dated posts with title+body (`Zakładanie kont 2014-02-17`, `Zadania z UZI 2012-10-24`, `Slajdy z wykładu`). No Markdown observed; old HTML.
- **Subpages**: free-form pages per contest (FAQ, Labs 1–8, assignment specs). Support file attachments (subject to filename rule below).
- **Membership**: open list + `Apply` + manual accept/reject. No invite codes (except `Access code` at register, purpose undocumented), no self-join link, no teams object (team = one account with bracket names).
- **Course usage**: Rust course uses subpages as lab modules, news for slides link. Implies teachers reuse contest as LMS-lite. No deadlines/grading export observed.
- **Archiving**: `Show archived` toggle; old UZI editions back to 2011 listed (dozens of `UZI, <date>` rows).

---

## 5. Problems

List page (`/contest/<id>/problems`) as reverse-engineered from `koishi`:

```
ProblemSet { title, problems[] }
Problem { code (e.g. "A"), id, name, note (em text), parent contest id }
DOM: //div[@id='content']/h4 (series title) + //div/table[@class='results']/tr
cols: td[1]=code, td[2]=a[name+href→id], .mainsphinx/p/em=note
```

- **Statement**: old tasks = PDF only (*"come from Athina times"*); new tasks = HTML (`mainsphinx`) + letter mismatch warning (*"letters on list differ from inside"*).
- **Limits**: ad-hoc; FAQ: *"typically ≥256 MB, no separate stack limit; time limits set automatically 'by eye', may be too strict/loose — report."* Compile options live at `/subpage/184196` (login-walled).
- **Tests**: hidden; defined by new `test specification format` thesis (Zieliński) + `kolejka-judge` library. No public sample I/O contract guaranteed.
- **Attachments**: PDFs + files via `content_files`. Filename rule (2013-05-23): **only `[A-Za-z0-9]` allowed** — submit/test/message-attachment/subpage-attachment with other chars fails silently-ish.

Pain: *"list is really long and loads slowly"* (Playground news 2011); no search/filter/hide (fixed only by extension: hide problems, highlight by best status, per-problem Results link).

---

## 6. Submit & Judge Pipeline

### 6.1 Submit (V1)

- **File upload only**. No paste box, no editor, no drag-drop, no GitHub import (extension adds paste).
- After submit: stays on page (no redirect; extension adds auto-redirect to latest results).
- No client-side validation except filename charset; no language picker documented (inferred from extension/CLI: language guessed from filename/choice).
- Languages (inferred from `kolejka-judge` + course usage): C, C++, Java (`satori.javatool`), Python (improved), Rust (improved), SQL (`C.sql` example), CUDA (added). Exact compiler flags live behind login.

### 6.2 Backend

```
[ satori.web (Django) ] → [ satori.core / satori.objects (ORM) ]
  → [ satori.ars? / satori.events ] → [ Kolejka Server (Django) ]
  → [ Kolejka Worker / Foreman on grid nodes (Docker + cgroups) ]
  → [ kolejka-judge lib runs tests ] → result back → satori.judge → web `results`
```

- **Original packages** (`PYTHON_PACKAGE_LIST`, Vagrant, `install.sh / install_judge.sh / install_submit.sh`): `satori.core, satori.objects, satori.web, satori.judge, satori.client.common, satori.javatool, satori.tools, satori.ars, satori.events, satori-testing, satori-testing-images`.
- **Modern backend**: **Kolejka** — *"lightweight task scheduling to unify/supersede satori and baca grids"* (Django + Docker + cgroups + JSON). Subsystems: Server (store+sched+ACL+post-steps), Client (CLI+wrappers), Worker (run one task), Observer (cgroups accounting sidecar), Foreman (node image). Docker images `kolejka/satori:{judge,extended,cuda}` on Docker Hub. Config via `~/.config/kolejka/kolejka.conf`, `pip install KolejkaWorker KolejkaClient` or PPA.
- **Judge authoring**: `kolejka-judge` (PyPI `KolejkaJudge`, MIT) — concise expressive test specs; CUDA by Raalsky, Python/Rust by Matuszek; thesis `Implementation of a new test specification format` = its docs.
- **Successor signal**: `BaCa2-project` (Django web + per-course DB routing + USOS API auto-enrollment + Package Manager PyPI + Broker→Kolejka) is the department's next-gen checker for courses — V2 must not ignore it.

### 6.3 Verdicts & Results

Results table (`table.results`, `?results_limit=`): `submit_id | problem code | datetime (YYYY-MM-DD HH:MM:SS) | status (div.submitstatus)`.

Statuses observed/inferred: `OK` (accepted), `ANS` (accepted? extension highlights `OK/ANS` as good), plus wrong/time/memory/runtime/compiler variants. UZI rules text confirms at least: *accepted vs rejected (wrong answer, time limit exceeded, runtime error)*; resubmit unlimited *"until it passes"*.

No auto-refresh, no notification, no syntax highlighting in V1 (all added by extension). No per-test breakdown visible anonymously; details behind login.

---

## 7. Ranking / Scoreboard

URL: `/contest/<cid>/ranking/<rid>`. Public for UZI (no login needed to view).

ICPC rules, textbook:

- Columns: `Rank | Name | Score (solved) | Time (penalty sum) | A..K` per problem.
- Cell: `-` (never tried) | `N` (tries, unsolved, e.g. `8`, `18`) | `N (H:MM)` (solved on Nth try at H:MM, e.g. `2 (1:41)`, `1 (0:30)`).
- Tie-break: more solved wins; tie → smaller total time + time penalties for wrong submits.
- Example (UZI 25.10.2025): winner `uj7 9 solved 1456 min`, 11 problems A–K, 30 teams.

V1 gaps: no sorting (extension adds), no search filter, header/left cols scroll away (extension sticks them), no freeze/replay, no per-person split (team = one row), no IOI mode, no CSV export observed.

---

## 8. Messaging, News, Misc

- Global news (3 items, last 2013) + per-contest news.
- Contact via e-mail images (`playgroundmail.png` to avoid spam) + forum `forum.tcs.uj.edu.pl`.
- Server time shown in header (`Server time: HH:MM:SS`) — only clock sync hint.
- Language: Polish UI with English bits (`Select contest`, `User profile`, `Affiliation`), no i18n switcher observed.
- Errors: *"System throws exception! It does for us too. Sometimes."* — stability jokes in official FAQ = reliability debt acknowledged.

---

## 9. Non-Functional Snapshot

- **Performance**: slow (Playground: *"long list loads long, we'll think"*; `mhorod/satori-cli` TODO: *"Satori is so slow we should cache to execute fewer requests"*).
- **UX**: *"ugly, slow and inconvenient"* (FAQ's own words). Clutter, weak link colors, no tab order, contest selector full page, no auto-redirect (all fixed by 16★ extension, not upstream).
- **Security**: upstream *"not safe for use"*; filename charset block as only visible hardening; no 2FA/SSO/rate-limit docs; exception leaks.
- **Accessibility/mobile**: tables without sticky headers, banner-only header, no responsive hints.
- **Observability**: none visible (no status page, no judge queue depth, no ETA).
- **License/ops**: MIT, Vagrant+shell installs, no Docker-Compose/K8s in V1 repo.

---

## 10. Ecosystem (Proof of Gaps)

| Project | What it proves V1 lacks |
|---|---|
| `m4tx/satori-enhancements` (WebExtension, 16★) | paste-to-submit, auto-refresh+notify, syntax highlight, sortable/searchable/sticky ranking, hide problems, status colors, popup contest switcher, keep-login, declutter |
| 4× CLIs (`zielmicha`, `mhorod`, `dominik-korsa` — `satori submit file.cpp` via URL-in-comment, `MasFlam` Julia) | no official API/CLI; must scrape + cookie hacks |
| `cloud11665/satori-points` + `koishi` | no points/stats export; must parse HTML |
| `TFKls/satori-git` | desire to version tasks via git |
| `kolejka/kolejka`, `kolejka-judge`, BaCa2 | judge & course futures already moved off Satori core |

---

## 11. Open Unknowns (Need Logged-In Probe for V2 Build)

- Full verdict enum + per-test detail JSON/HTML; compiler flags per language; exact time/memory enforcement (cgroups v1 vs v2).
- Teacher flow: create contest/problem/test/ranking steps, rejudge, member CSV import, plagiarism view.
- Course grading: deadlines, points → USOS export, per-lab weights.
- Teams: real teams object or account hack? Freeze & clarifications during UZI?
- Attachments quota, message system, e-mail notifications.
- DB schema, scale numbers (submits/day, workers count).

---

## References

- https://satori.tcs.uj.edu.pl/ , /contest/select, /contest/251519/, /contest/251519/subpage/275018, /contest/8677128/, /contest/10193118/ranking/10206532, /subpage/3864210, /register
- Mirrors: https://github.com/zielmicha/satori , https://github.com/TFKls/satori-git
- Extension: https://github.com/m4tx/satori-enhancements
- CLIs: https://github.com/mhorod/satori-cli , https://github.com/dominik-korsa/satori-cli , https://github.com/MasFlam/SatoriCLI.jl , https://github.com/zielmicha/satori-cli
- Points/scrape: https://github.com/cloud11665/satori-points
- Judge: https://github.com/kolejka/kolejka-judge , https://kolejka.matinf.uj.edu.pl/ , https://github.com/kolejka/kolejka , thesis RUJ item/234085
- Next-gen: BaCa2-project (Django + USOS + Broker→Kolejka)
