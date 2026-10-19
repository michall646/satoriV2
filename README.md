# Satori V2

API-first online judge + contest/course hosting.
Rewrite of V1 (`SATORI_V1_SPEC.md`), implements `SATORI_V2_PROPOSAL.md` P0+P1+P2.

## Quick start (one command, zero-install)

```bash
npm run demo
# -> API http://localhost:3001
# -> Demo UI (no install) http://localhost:3001/demo
# -> OpenAPI at /api/openapi.json
# login: jan_kowalski / student123
```

Web (Next.js):
```bash
cd apps/web && npm install && npm run dev
```

CLI:
```bash
node apps/cli/bin/satori.js contests --token <JWT>
node apps/cli/bin/satori.js submit solution.cpp --problem A --contest 251519
```

## Layout

- `apps/api` — REST + SSE/WS, JSON-file storage (Postgres-ready via repository interface), JWT auth, RBAC
- `packages/judge` — Kolejka-compat queue + runners + checkers (`kolejka-judge` format subset)
- `apps/web` — Next.js App Router, PL/EN, dark mode, inline verdict cockpit (B2.1)
- `apps/cli` + `packages/sdk` — official CLI/SDK, absorbs scraping CLIs
- `importers/` — V1 HTML dump, Polygon ZIP, Athina PDF bulk
- `tests/` — `node --test`, AAA, positive+negative per behavior

## Principles

- API-first, scrape-never. Every click = REST + SSE.
- Contest is king: `ICPC | IOI | LABS | EXAM | PLAYGROUND | VIRTUAL`.
- No silent failures: filename charset, limits, queue ETA always visible.
- Coexist then replace: V1 redirects preserved (`/contest/<id>/problems/<pid>`).

See `docs/` for API, judge, authoring, teacher guides.
