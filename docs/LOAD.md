# Load testing & metrics

Operational guide for G8 (observability) and G10 (load). The API exposes
Prometheus text metrics and ships a dependency-free load generator. Neither
changes user-facing behavior.

## Metrics endpoint

```
GET /api/metrics       Prometheus text exposition 0.0.4
GET /api/metrics.json  JSON snapshot (tests, ad-hoc inspection)
```

Set `SATORI_METRICS_TOKEN` to require `Authorization: Bearer <token>` on both
endpoints. The query fallback `?token=<token>` is supported for simple scrapers;
prefer the header because query strings tend to end up in access logs.

```bash
# public (token unset)
curl -s http://localhost:3001/api/metrics

# gated
SATORI_METRICS_TOKEN=change-me npm run dev:api
curl -s -H 'Authorization: Bearer change-me' http://localhost:3001/api/metrics
```

The token gate is read at request time, so rotating the environment variable
takes effect without a restart.

### Metric families

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `satori_http_requests_total` | counter | `method`, `route`, `status` | Completed requests |
| `satori_http_request_duration_seconds` | histogram | `route` | Wall-clock duration |
| `satori_process_uptime_seconds` | gauge | — | Seconds since process start |
| `satori_process_resident_memory_bytes` | gauge | — | Process RSS |
| `satori_judge_queue_depth` | gauge | — | Submissions waiting in the judge queue |

Histogram buckets: 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 ms,
`+Inf` (le values are in seconds).

`route` is a template, never a raw path: `/api/contests/251519/ranking` is
recorded as `/api/contests/:id/ranking`. Query strings, logins, session tokens,
user ids and unknown `/api/*` paths do not appear in labels. There is no
`queue_capacity` metric because the in-process queue is unbounded; a real
capacity gauge arrives with the persistent (Postgres) queue.

### Prometheus scrape config

```yaml
scrape_configs:
  - job_name: satori-api
    metrics_path: /api/metrics
    scheme: http
    authorization:
      credentials_file: /etc/prometheus/satori-metrics-token
    static_configs:
      - targets: ['127.0.0.1:3001']
```

Put the token alone on one line in the credentials file. If metrics stay
public, omit the `authorization` block.

## Load test

```bash
node scripts/load-test.js
```

Defaults: base `http://localhost:3001`, login `jan_kowalski` / `student123`,
10 seconds, 20 workers, paths `/api/health`, `/api/contests`,
`/api/contests/251519/ranking`. Node 20+ built-in `fetch` only; no install.

```bash
# logged-in run against a local API
node scripts/load-test.js --base http://localhost:3001

# reuse a token, mixed read paths, longer run
node scripts/load-test.js \
  --base http://127.0.0.1:3001 \
  --token "$SATORI_TOKEN" \
  --duration 30s \
  --concurrency 50 \
  --path /api/health \
  --path /api/contests/251519 \
  --path /api/contests/251519/ranking
```

| Flag | Default | Notes |
|------|---------|-------|
| `--base` | `http://localhost:3001` | `http(s)` only |
| `--token` | — | Skips login when set |
| `--login` | `jan_kowalski` | Used only without `--token` |
| `--password` | `student123` | Used only without `--token` |
| `--duration` | `10s` | `10s`, `500ms`, or bare milliseconds |
| `--concurrency` | `20` | Parallel workers |
| `--path` | three defaults | Repeatable |

The script logs in once, warms each path once, then runs until the deadline.
Each request drains its body so the measurement includes response time. Exit
codes: `0` at most 1% errors, `1` above the threshold (or no completed
requests), `2` usage/login failure.

### Example output (illustrative — not a benchmark result)

```
Satori load test -> http://localhost:3001
  paths       /api/health, /api/contests, /api/contests/251519/ranking
  concurrency 20
  duration    10000 ms

Results
  total       18422 requests in 10004 ms
  RPS         1841.46
  latency ms  p50=9.12 p95=24.8 p99=41.3 max=118.4
  errors      0 (0%), network 0
  status      200: 18422
```

### Reading the numbers

- **RPS** is completed requests divided by actual run time; warmup is excluded.
  It measures this API process + local disk, not a production cluster.
- **p50/p95/p99** are per-request wall times across all paths, including body
  reads. A p99 far above p50 usually means store flushes, JSON serialization or
  the judge worker competing for the event loop.
- **errors** counts HTTP `>= 400` plus network failures. The exit threshold is
  strict on purpose: a 403 path (missing membership, hidden board) is an error
  here, so fix the token/path list rather than ignoring it.
- **status** breakdown distinguishes expected rejects (401/403/404) from server
  errors (5xx) and `ERR` (connection/timeout).

## Local runner caveat

The judge currently runs in one `worker_thread` with an interim local runner.
**Memory limits are not enforced** (see `docs/JUDGE_SANDBOX.md`); CPU/wall
limits and output caps are. A load run therefore measures the API and queue,
not sandbox isolation. Do not treat local numbers as a production capacity
plan.

Also relevant:

- Storage is JSON files with a shared lock; concurrent writes are serialized.
  Postgres is a handoff (G9), and its numbers will differ substantially.
- The judge queue is in-process and unbounded. `satori_judge_queue_depth` shows
  backpressure; there is no capacity or dead-letter metric yet.
- Running the load test against the same machine that runs the API and judge
  competes for CPU. Use `--concurrency` modestly on laptops.

## Handoffs

- **OpenTelemetry / Sentry (G8 remainder):** metrics are aggregated only; no
  traces, no exception reporting, no audit-actor correlation.
- **Postgres (G9):** swap the store and add queue capacity/dead-letter gauges;
  then publish real capacity numbers.
- **Alerting:** no alert rules or notification transport. Suggested starters:
  `satori_judge_queue_depth > 20 for 5m`, p95 duration > 1s, 5xx ratio > 1%.
- **Multi-worker judge:** queue depth currently reflects one process. A shared
  queue needs per-worker and global depth labels.
- **Load (G10 remainder):** add authenticated submit paths and SSE subscribers
  to the scenario once rate limits and worker throughput are sized.
