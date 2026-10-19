// Satori V2 — in-process operational metrics (G8/C9).
//
// No runtime dependencies. Counters, gauges and histograms with deliberately
// bounded label sets: request labels are derived from a fixed route template
// list, never from a raw path. Query strings, numeric ids, session tokens,
// logins and user ids therefore never reach a metric label.
'use strict';

// Buckets are defined in milliseconds (the unit handlers measure) and exposed
// as seconds because the metric is named `..._duration_seconds`.
const DURATION_BUCKETS_MS = Object.freeze([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
const DURATION_BUCKETS_SECONDS = Object.freeze(DURATION_BUCKETS_MS.map((ms) => ms / 1000));

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const MAX_ROUTES = 200; // hard cap on distinct route labels
const MAX_LABEL_VALUE = 200;

const counters = new Map(); // key -> { name, labels, value }
const gauges = new Map();
const histograms = new Map();
const knownRoutes = new Set();

// Exact paths only. Anything else is matched against a template below or
// collapses to a safe placeholder.
const STATIC_PATHS = new Set([
  '/', '/api', '/demo',
  '/api/health', '/api/status', '/api/languages',
  '/api/openapi.json', '/api/openapi.yaml',
  '/api/metrics', '/api/metrics.json',
  '/api/orgs', '/api/search',
  '/api/auth/register', '/api/auth/token', '/api/auth/refresh', '/api/auth/revoke',
  '/api/auth/forgot', '/api/auth/reset',
  '/api/auth/2fa/setup', '/api/auth/2fa/enable', '/api/auth/2fa/disable', '/api/auth/2fa/verify',
  '/api/me', '/api/me/sessions', '/api/me/teams', '/api/me/password',
  '/api/contests', '/api/webhooks',
  '/api/submits', '/api/submits/sample-run', '/api/submits/codes.zip',
  '/api/notifications', '/api/notifications/read', '/api/notifications/prefs',
  '/api/notes',
]);

// Ordered specific -> generic. `route` is a literal template or a function of
// the regex match, allowing static action names to stay visible in labels.
const ROUTE_TEMPLATES = [
  // account sessions (opaque token must never be a label)
  [/^\/api\/me\/sessions\/[^/]+$/, '/api/me/sessions/:id'],

  // contest teams / members
  [/^\/api\/contests\/\d+\/teams\/\d+\/members\/\d+$/, '/api/contests/:id/teams/:id/members/:id'],
  [/^\/api\/contests\/\d+\/teams\/\d+\/(join|leave|invite)$/, (m) => `/api/contests/:id/teams/:id/${m[1]}`],
  [/^\/api\/contests\/\d+\/teams\/\d+$/, '/api/contests/:id/teams/:id'],
  [/^\/api\/contests\/\d+\/teams$/, '/api/contests/:id/teams'],
  [/^\/api\/contests\/\d+\/members\/(approve|csv)$/, (m) => `/api/contests/:id/members/${m[1]}`],
  [/^\/api\/contests\/\d+\/members\/\d+$/, '/api/contests/:id/members/:id'],
  [/^\/api\/contests\/\d+\/members$/, '/api/contests/:id/members'],

  // contest webhooks
  [/^\/api\/contests\/\d+\/webhooks\/deliveries$/, '/api/contests/:id/webhooks/deliveries'],
  [/^\/api\/contests\/\d+\/webhooks\/\d+\/ping$/, '/api/contests/:id/webhooks/:id/ping'],
  [/^\/api\/contests\/\d+\/webhooks\/\d+$/, '/api/contests/:id/webhooks/:id'],
  [/^\/api\/contests\/\d+\/webhooks$/, '/api/contests/:id/webhooks'],

  // comms
  [/^\/api\/contests\/\d+\/news\.rss$/, '/api/contests/:id/news.rss'],
  [/^\/api\/contests\/\d+\/news\/\d+\/read$/, '/api/contests/:id/news/:id/read'],
  [/^\/api\/contests\/\d+\/clarifications\/\d+\/answer$/, '/api/contests/:id/clarifications/:id/answer'],
  [/^\/api\/contests\/\d+\/(clarifications|news|subpages)\/\d+$/, (m) => `/api/contests/:id/${m[1]}/:id`],
  [/^\/api\/contests\/\d+\/(clarifications|news|subpages)$/, (m) => `/api/contests/:id/${m[1]}`],

  // grades
  [/^\/api\/contests\/\d+\/grade\/overrides\/\d+$/, '/api/contests/:id/grade/overrides/:id'],
  [/^\/api\/contests\/\d+\/grade\/(matrix|analytics|usos-import|overrides|release|rejudge|codes\.zip|extend-selected|export\.csv|preview|feedback)$/,
    (m) => `/api/contests/:id/grade/${m[1]}`],

  // integrity / exam
  [/^\/api\/contests\/\d+\/integrity\/appeals\/mine$/, '/api/contests/:id/integrity/appeals/mine'],
  [/^\/api\/contests\/\d+\/integrity\/appeals\/\d+$/, '/api/contests/:id/integrity/appeals/:id'],
  [/^\/api\/contests\/\d+\/integrity\/(similarity|timeline|appeals)$/, (m) => `/api/contests/:id/integrity/${m[1]}`],
  [/^\/api\/contests\/\d+\/exam\/violations$/, '/api/contests/:id/exam/violations'],
  [/^\/api\/contests\/\d+\/exam$/, '/api/contests/:id/exam'],

  // contest static actions
  [/^\/api\/contests\/\d+\/(apply|duplicate|problems|rankings\/live|ranking|ranking\.csv|grade|grade\.ics|deadlines\/bulk-extend|audit)$/,
    (m) => `/api/contests/:id/${m[1]}`],
  [/^\/api\/contests\/\d+$/, '/api/contests/:id'],

  // problem tests / actions
  [/^\/api\/problems\/\d+\/tests\/groups\/[^/]+$/, '/api/problems/:id/tests/groups/:id'],
  [/^\/api\/problems\/\d+\/tests\/cases\/[^/]+$/, '/api/problems/:id/tests/cases/:id'],
  [/^\/api\/problems\/\d+\/tests\/(export|import)$/, (m) => `/api/problems/:id/tests/${m[1]}`],
  [/^\/api\/problems\/\d+\/tests\/[^/]+$/, '/api/problems/:id/tests/:id'],
  [/^\/api\/problems\/\d+\/(limitHistory|versions)$/, (m) => `/api/problems/:id/${m[1]}`],
  [/^\/api\/problems\/\d+\/(validators\/run|reference\/run|reference\/generate|stress)$/, (m) => `/api/problems/:id/${m[1]}`],
  [/^\/api\/problems\/\d+\/(tests|best|heatmap|clone|rejudge|submit)$/, (m) => `/api/problems/:id/${m[1]}`],
  [/^\/api\/problems\/\d+$/, '/api/problems/:id'],

  // submits / notes
  [/^\/api\/submits\/\d+\/(events|rejudge)$/, (m) => `/api/submits/:id/${m[1]}`],
  [/^\/api\/submits\/\d+$/, '/api/submits/:id'],
  [/^\/api\/notes\/\d+$/, '/api/notes/:id'],

  // defensive templates for routes that may be added later (org admin, users)
  [/^\/api\/users\/[^/]+(?:\/.*)?$/, '/api/users/:id'],
  [/^\/api\/orgs\/[^/]+(?:\/.*)?$/, '/api/orgs/:id'],
  [/^\/api\/news\/[^/]+(?:\/.*)?$/, '/api/news/:id'],

  // V1 compatibility paths
  [/^\/contest\/\d+\/problems\/\d+$/, '/contest/:id/problems/:id'],
  [/^\/contest\/\d+\/problems$/, '/contest/:id/problems'],
  [/^\/contest\/\d+\/ranking\/\d+$/, '/contest/:id/ranking/:id'],
  [/^\/contest\/\d+\/results$/, '/contest/:id/results'],
  [/^\/contest\/\d+$/, '/contest/:id'],
  [/^\/subpage\/\d+$/, '/subpage/:id'],
];

const HELP = {
  satori_http_requests_total: 'Total HTTP requests by method, route and status.',
  satori_http_request_duration_seconds: 'HTTP request duration in seconds.',
  satori_judge_queue_depth: 'Submissions waiting in the judge queue.',
};

// Prometheus exposition requires escaping backslash, quote and newline.
function escapeLabel(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function normalizeLabels(labels) {
  const out = {};
  for (const key of Object.keys(labels || {}).sort()) {
    const value = labels[key];
    if (value == null) continue;
    out[key] = String(value).slice(0, MAX_LABEL_VALUE);
  }
  return out;
}

function labelKey(labels) {
  return Object.keys(labels).sort().map((key) => `${key}=${labels[key]}`).join('\u0001');
}

function seriesKey(name, labels) {
  return `${name}\u0000${labelKey(labels)}`;
}

function normalizeMethod(method) {
  const value = String(method || '').toUpperCase();
  return METHODS.has(value) ? value : 'OTHER';
}

function normalizeStatus(status) {
  const code = Number(status);
  return Number.isInteger(code) && code >= 100 && code <= 599 ? String(code) : '0';
}

function trackRoute(route) {
  const value = String(route || '/__other__').slice(0, MAX_LABEL_VALUE);
  if (knownRoutes.has(value)) return value;
  if (knownRoutes.size >= MAX_ROUTES) return '/__other__';
  knownRoutes.add(value);
  return value;
}

// Maps an arbitrary request path to a bounded route label. Unknown /api paths
// collapse to one bucket so client-supplied path text can never explode
// cardinality or leak identifiers.
function normalizePath(rawPath) {
  let value = String(rawPath == null ? '' : rawPath);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try { value = new URL(value).pathname; } catch { value = ''; }
  }
  const cut = value.search(/[?#]/);
  if (cut >= 0) value = value.slice(0, cut);
  try { value = decodeURIComponent(value); } catch { /* keep raw */ }
  value = value.replace(/\/{2,}/g, '/');
  if (value.length > 1) value = value.replace(/\/+$/, '');
  if (!value) value = '/';
  if (value[0] !== '/') value = `/${value}`;

  if (STATIC_PATHS.has(value)) return trackRoute(value);

  for (const [pattern, route] of ROUTE_TEMPLATES) {
    const match = pattern.exec(value);
    if (match) return trackRoute(typeof route === 'function' ? route(match) : route);
  }

  return trackRoute(value.startsWith('/api/') ? '/api/__unmatched__' : '/__other__');
}

function addCounter(name, labels = {}, delta = 1) {
  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) return;
  const normalized = normalizeLabels(labels);
  const key = seriesKey(name, normalized);
  const entry = counters.get(key);
  if (entry) entry.value += amount;
  else counters.set(key, { name, labels: normalized, value: amount });
}

function setGauge(name, labels, value) {
  const amount = Number(value);
  const normalized = normalizeLabels(labels);
  const key = seriesKey(name, normalized);
  gauges.set(key, { name, labels: normalized, value: Number.isFinite(amount) ? amount : 0 });
}

function getGauge(name, labels = {}) {
  const entry = gauges.get(seriesKey(name, normalizeLabels(labels)));
  return entry ? entry.value : null;
}

function observeHistogram(name, labels, value, buckets = DURATION_BUCKETS_SECONDS) {
  let observed = Number(value);
  if (!Number.isFinite(observed) || observed < 0) observed = 0;
  const bounds = Array.isArray(buckets) && buckets.length ? buckets.slice() : DURATION_BUCKETS_SECONDS.slice();
  const normalized = normalizeLabels(labels);
  const key = seriesKey(name, normalized);
  let entry = histograms.get(key);
  if (!entry) {
    entry = { name, labels: normalized, bounds, counts: new Array(bounds.length).fill(0), count: 0, sum: 0 };
    histograms.set(key, entry);
  }
  // Counts are stored cumulatively, matching the exposition format.
  for (let i = 0; i < entry.bounds.length; i += 1) {
    if (observed <= entry.bounds[i]) entry.counts[i] += 1;
  }
  entry.count += 1;
  entry.sum += observed;
}

// Records one completed HTTP request. `path` is a pathname (a full URL or a
// query string is tolerated), `durationMs` is wall time from the router.
function observeRequest(method, path, status, durationMs) {
  const route = normalizePath(path);
  const ms = Number(durationMs);
  const elapsedMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  addCounter('satori_http_requests_total', {
    method: normalizeMethod(method),
    route,
    status: normalizeStatus(status),
  });
  observeHistogram('satori_http_request_duration_seconds', { route }, elapsedMs / 1000);
}

function tidy(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : Number(n.toFixed(6));
}

function compareSeries(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return labelKey(a.labels) < labelKey(b.labels) ? -1 : 1;
}

function listSeries(store) {
  return [...store.values()].sort(compareSeries).map((entry) => ({
    name: entry.name,
    labels: { ...entry.labels },
    value: tidy(entry.value),
  }));
}

function formatBound(bound) {
  return String(bound);
}

function snapshot() {
  const memory = process.memoryUsage();
  const queueDepth = getGauge('satori_judge_queue_depth', {});
  return {
    generatedAt: new Date().toISOString(),
    process: {
      uptimeSeconds: tidy(process.uptime()),
      residentMemoryBytes: memory.rss,
    },
    judge: {
      queueDepth: queueDepth == null ? 0 : tidy(queueDepth),
    },
    counters: listSeries(counters),
    gauges: listSeries(gauges),
    histograms: [...histograms.values()].sort(compareSeries).map((entry) => ({
      name: entry.name,
      labels: { ...entry.labels },
      count: entry.count,
      sumSeconds: tidy(entry.sum),
      buckets: [
        ...entry.bounds.map((bound, index) => ({
          le: formatBound(bound),
          count: entry.counts[index],
        })),
        { le: '+Inf', count: entry.count },
      ],
    })),
  };
}

function formatLabels(labels, extra) {
  const merged = { ...labels, ...(extra || {}) };
  const keys = Object.keys(merged).sort();
  if (!keys.length) return '';
  return `{${keys.map((key) => `${key}="${escapeLabel(merged[key])}"`).join(',')}}`;
}

function formatValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(6)));
}

function appendFamily(lines, type, map) {
  const families = new Map();
  for (const entry of map.values()) {
    if (!families.has(entry.name)) families.set(entry.name, []);
    families.get(entry.name).push(entry);
  }
  for (const name of [...families.keys()].sort()) {
    if (HELP[name]) lines.push(`# HELP ${name} ${HELP[name]}`);
    lines.push(`# TYPE ${name} ${type}`);
    for (const entry of families.get(name).sort(compareSeries)) {
      lines.push(`${name}${formatLabels(entry.labels)} ${formatValue(entry.value)}`);
    }
  }
}

// Prometheus text exposition format 0.0.4.
function prometheus() {
  const lines = [];
  appendFamily(lines, 'counter', counters);
  appendFamily(lines, 'gauge', gauges);

  const families = new Map();
  for (const entry of histograms.values()) {
    if (!families.has(entry.name)) families.set(entry.name, []);
    families.get(entry.name).push(entry);
  }
  for (const name of [...families.keys()].sort()) {
    if (HELP[name]) lines.push(`# HELP ${name} ${HELP[name]}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const entry of families.get(name).sort(compareSeries)) {
      for (let i = 0; i < entry.bounds.length; i += 1) {
        lines.push(`${name}_bucket${formatLabels(entry.labels, { le: formatBound(entry.bounds[i]) })} ${entry.counts[i]}`);
      }
      lines.push(`${name}_bucket${formatLabels(entry.labels, { le: '+Inf' })} ${entry.count}`);
      lines.push(`${name}_sum${formatLabels(entry.labels)} ${formatValue(entry.sum)}`);
      lines.push(`${name}_count${formatLabels(entry.labels)} ${entry.count}`);
    }
  }

  lines.push('# HELP satori_process_uptime_seconds Seconds since the API process started.');
  lines.push('# TYPE satori_process_uptime_seconds gauge');
  lines.push(`satori_process_uptime_seconds ${formatValue(process.uptime())}`);
  lines.push('# HELP satori_process_resident_memory_bytes Resident set size of the API process.');
  lines.push('# TYPE satori_process_resident_memory_bytes gauge');
  lines.push(`satori_process_resident_memory_bytes ${formatValue(process.memoryUsage().rss)}`);

  return `${lines.join('\n')}\n`;
}

function reset() {
  counters.clear();
  gauges.clear();
  histograms.clear();
  knownRoutes.clear();
  setGauge('satori_judge_queue_depth', {}, 0);
}

// The gauge is always present (route scrapes refresh it from judgeQueue).
setGauge('satori_judge_queue_depth', {}, 0);

module.exports = {
  DURATION_BUCKETS_MS,
  DURATION_BUCKETS_SECONDS,
  MAX_ROUTES,
  normalizePath,
  normalizeMethod,
  normalizeStatus,
  addCounter,
  incCounter: addCounter,
  setGauge,
  observeHistogram,
  observeRequest,
  snapshot,
  prometheus,
  reset,
};
