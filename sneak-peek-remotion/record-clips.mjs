// Playwright High-Res Recorder & Metadata Logger for Satori V2 Sneak Peek
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };
const BASE_URL = 'http://localhost:3000';

// Realistic, aesthetically pleasing competitive programming & university course data
const MOCK_ME = {
  id: 42,
  login: 'm_kaczmarek',
  firstName: 'Mateusz',
  lastName: 'Kaczmarek',
  email: 'm.kaczmarek@tcs.uj.edu.pl',
  affiliationOrgId: 1,
  rolesGlobal: ['student'],
};

const MOCK_CONTESTS = [
  {
    id: 10193118,
    name: 'XLII UZI Finals — Geometry & Flows',
    description: 'Jagiellonian University ICPC Championship · 7 flagship problems.',
    mode: 'ICPC',
    lifecycle: 'running',
    registration: 'invite',
    archived: false,
    startAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    endAt: new Date(Date.now() + 1 * 3600 * 1000 + 42 * 60 * 1000).toISOString(),
    freezeAt: new Date(Date.now() + 42 * 60 * 1000).toISOString(),
    settings: { penaltyMin: 20, verdictVisibility: 'all', allowSampleRun: true },
  },
  {
    id: 8677128,
    name: 'Algorithmic Graph Theory, 2026/27',
    description: 'TCS Advanced Labs — Flows, Matchings, Link-Cut Trees.',
    mode: 'LABS',
    lifecycle: 'running',
    registration: 'invite',
    archived: false,
    startAt: new Date(Date.now() - 14 * 86400 * 1000).toISOString(),
    endAt: new Date(Date.now() + 5 * 86400 * 1000).toISOString(),
  },
  {
    id: 251519,
    name: 'Satori Archive · Central Europe OI',
    description: 'Curated Olympiad & CERC tasks with full test telemetry.',
    mode: 'PLAYGROUND',
    lifecycle: 'running',
    registration: 'open',
    archived: false,
    startAt: '2024-10-01T00:00:00Z',
    endAt: null,
  },
];

const MOCK_PROBLEMS = [
  {
    id: 301,
    contestId: 10193118,
    code: 'A',
    name: 'Minkowski Sum of Star Polygons',
    solvesPct: 84,
    difficulty: 2,
    tags: ['geometry', 'convex-hull'],
    _best: 'OK',
    _score: 100,
    _tries: 1,
    effectiveDeadline: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
    deadlineSource: 'contest',
  },
  {
    id: 302,
    contestId: 10193118,
    code: 'B',
    name: 'Heavy-Light Path Queries on Cactus',
    solvesPct: 68,
    difficulty: 3,
    tags: ['trees', 'hld'],
    _best: 'OK',
    _score: 100,
    _tries: 2,
    effectiveDeadline: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
    deadlineSource: 'contest',
  },
  {
    id: 303,
    contestId: 10193118,
    code: 'C',
    name: 'Dinic Blocking Flow in Planar Networks',
    solvesPct: 49,
    difficulty: 4,
    tags: ['flows', 'planar-graphs'],
    _best: 'TLE',
    _score: 60,
    _tries: 3,
    effectiveDeadline: new Date(Date.now() + 18 * 3600 * 1000).toISOString(),
    deadlineSource: 'problem',
  },
  {
    id: 304,
    contestId: 10193118,
    code: 'D',
    name: 'Online Suffix Automaton over Trees',
    solvesPct: 41,
    difficulty: 4,
    tags: ['strings', 'automata'],
    _best: 'OK',
    _score: 100,
    _tries: 1,
    effectiveDeadline: new Date(Date.now() + 3 * 86400 * 1000).toISOString(),
    deadlineSource: 'contest',
  },
  {
    id: 305,
    contestId: 10193118,
    code: 'E',
    name: 'Persistent Li Chao Segment Tree',
    solvesPct: 57,
    difficulty: 3,
    tags: ['data-structures', 'dp'],
    _best: 'OK',
    _score: 100,
    _tries: 2,
    effectiveDeadline: new Date(Date.now() + 3 * 86400 * 1000).toISOString(),
    deadlineSource: 'contest',
  },
  {
    id: 306,
    contestId: 10193118,
    code: 'F',
    name: 'Matroid Intersection on Hypergraphs',
    solvesPct: 19,
    difficulty: 5,
    tags: ['matroids', 'combinatorics'],
    _best: 'WA',
    _score: 25,
    _tries: 4,
    effectiveDeadline: new Date(Date.now() + 4 * 86400 * 1000).toISOString(),
    deadlineSource: 'contest',
  },
  {
    id: 307,
    contestId: 10193118,
    code: 'G',
    name: 'Deterministic Miller-Rabin Witness Sieve',
    solvesPct: 31,
    difficulty: 4,
    tags: ['number-theory'],
    _best: null,
    _score: null,
    _tries: 0,
    effectiveDeadline: new Date(Date.now() + 5 * 86400 * 1000).toISOString(),
    deadlineSource: 'contest',
  },
];

const CPP_SNIPPET = `#include <bits/stdc++.h>
using namespace std;

struct Dinic {
  struct Edge { int to, rev; long long cap; };
  vector<vector<Edge>> adj;
  vector<int> lvl, ptr;
  bool bfs(int s, int t) {
    fill(lvl.begin(), lvl.end(), -1);
    queue<int> q({s}); lvl[s] = 0;
    while (!q.empty()) {
      int v = q.front(); q.pop();
      for (auto &e : adj[v])
        if (e.cap > 0 && lvl[e.to] == -1)
          lvl[e.to] = lvl[v] + 1, q.push(e.to);
    }
    return lvl[t] != -1;
  }
};`;

const MOCK_SUBMIT_STAGES = {
  QUE: {
    id: 4092,
    contestId: 10193118,
    problemId: 303,
    status: 'QUE',
    phase: 'QUE',
    lang: 'C++20 (g++ 13.2 -O3)',
    filename: 'dinic_planar.cpp',
    cpuMs: 0,
    memMb: 0,
    code: CPP_SNIPPET,
    createdAt: new Date().toISOString(),
    perTest: [],
  },
  CMP: {
    id: 4092,
    contestId: 10193118,
    problemId: 303,
    status: 'CMP',
    phase: 'CMP',
    lang: 'C++20 (g++ 13.2 -O3)',
    filename: 'dinic_planar.cpp',
    cpuMs: 0,
    memMb: 0,
    code: CPP_SNIPPET,
    createdAt: new Date().toISOString(),
    perTest: [],
  },
  TST: {
    id: 4092,
    contestId: 10193118,
    problemId: 303,
    status: 'TST',
    phase: 'TST',
    testsDone: 5,
    testsTotal: 7,
    lang: 'C++20 (g++ 13.2 -O3)',
    filename: 'dinic_planar.cpp',
    cpuMs: 38,
    memMb: 18,
    code: CPP_SNIPPET,
    createdAt: new Date().toISOString(),
    perTest: [
      { n: '1a', verdict: 'OK', timeMs: 4, memMb: 12, msg: 'ok (planar dual s-t cut = 420)' },
      { n: '1b', verdict: 'OK', timeMs: 9, memMb: 14, msg: 'ok (n = 12,000, m = 35,994)' },
      { n: '2a', verdict: 'OK', timeMs: 18, memMb: 16, msg: 'ok (blocking flow 9 phases)' },
      { n: '2b', verdict: 'OK', timeMs: 27, memMb: 18, msg: 'ok (dense triangulated grid)' },
      { n: '3a', verdict: 'OK', timeMs: 38, memMb: 18, msg: 'ok (anti-dinic gadget passed)' },
      { n: '3b', verdict: 'TST', timeMs: null, memMb: null, msg: 'running on worker-04…' },
      { n: '4a', verdict: 'QUE', timeMs: null, memMb: null, msg: 'queued' },
    ],
  },
  OK: {
    id: 4092,
    contestId: 10193118,
    problemId: 303,
    status: 'OK',
    phase: 'OK',
    lang: 'C++20 (g++ 13.2 -O3)',
    filename: 'dinic_planar.cpp',
    cpuMs: 54,
    memMb: 22,
    code: CPP_SNIPPET,
    createdAt: new Date().toISOString(),
    perTest: [
      { n: '1a', verdict: 'OK', timeMs: 4, memMb: 12, msg: 'ok (planar dual s-t cut = 420)' },
      { n: '1b', verdict: 'OK', timeMs: 9, memMb: 14, msg: 'ok (n = 12,000, m = 35,994)' },
      { n: '2a', verdict: 'OK', timeMs: 18, memMb: 16, msg: 'ok (blocking flow 9 phases)' },
      { n: '2b', verdict: 'OK', timeMs: 27, memMb: 18, msg: 'ok (dense triangulated grid)' },
      { n: '3a', verdict: 'OK', timeMs: 38, memMb: 18, msg: 'ok (anti-dinic gadget passed)' },
      { n: '3b', verdict: 'OK', timeMs: 49, memMb: 21, msg: 'ok (max-cap 10^15 · 0.049s)' },
      { n: '4a', verdict: 'OK', timeMs: 54, memMb: 22, msg: 'ok (extremal spiral · 100/100 pts)' },
    ],
  },
};

// Inject dark theme, English UI, EventSource mock hook, and custom sleek glowing cursor + click ripple
const INIT_SCRIPT = `
(function() {
  try {
    localStorage.setItem('satori-theme', 'dark');
    localStorage.setItem('satori-lang', 'en');
    localStorage.setItem('satori-recent', '10193118');
    localStorage.setItem('satori-hide-solved', 'false');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  } catch (e) {}

  // Override EventSource so we can push deterministic sub-second live verdicts from Playwright!
  window.__esListeners = [];
  class MockEventSource {
    constructor(url) {
      this.url = url;
      this.onmessage = null;
      window.__esListeners.push(this);
    }
    close() {
      const idx = window.__esListeners.indexOf(this);
      if (idx >= 0) window.__esListeners.splice(idx, 1);
    }
  }
  window.EventSource = MockEventSource;
  window.__pushSSE = function(payload) {
    const ev = { data: JSON.stringify(payload) };
    for (const es of [...window.__esListeners]) {
      if (typeof es.onmessage === 'function') {
        try { es.onmessage(ev); } catch (e) {}
      }
    }
  };

  function mountCursor() {
    if (document.getElementById('__sp_cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      * { cursor: none !important; }
      #__sp_cursor {
        position: fixed;
        top: 0; left: 0;
        width: 24px; height: 24px;
        margin-left: -12px; margin-top: -12px;
        border-radius: 9999px;
        border: 1.5px solid rgba(122, 165, 255, 0.88);
        background: radial-gradient(circle, rgba(91, 141, 239, 0.38) 0%, rgba(47, 107, 255, 0.08) 70%, transparent 100%);
        box-shadow: 0 0 18px rgba(91, 141, 239, 0.68), inset 0 0 6px rgba(168, 196, 255, 0.4);
        pointer-events: none;
        z-index: 2147483647;
        transform: translate3d(-100px, -100px, 0);
        transition: width 140ms ease, height 140ms ease, margin 140ms ease, border-color 140ms ease, background 140ms ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #__sp_cursor::after {
        content: '';
        width: 5px; height: 5px;
        border-radius: 9999px;
        background: #ffffff;
        box-shadow: 0 0 8px #5b8def;
      }
      #__sp_cursor.is-down {
        width: 18px; height: 18px;
        margin-left: -9px; margin-top: -9px;
        border-color: #ffffff;
        background: rgba(91, 141, 239, 0.65);
      }
      .__sp_ripple {
        position: fixed;
        width: 12px; height: 12px;
        margin-left: -6px; margin-top: -6px;
        border-radius: 9999px;
        border: 2px solid rgba(122, 165, 255, 0.95);
        box-shadow: 0 0 24px rgba(91, 141, 239, 0.85);
        pointer-events: none;
        z-index: 2147483646;
        animation: __sp_ripple_anim 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes __sp_ripple_anim {
        0% { transform: scale(0.6); opacity: 1; }
        100% { transform: scale(4.8); opacity: 0; }
      }
    \`;
    document.head.appendChild(style);

    const cur = document.createElement('div');
    cur.id = '__sp_cursor';
    document.body.appendChild(cur);

    window.addEventListener('pointermove', (e) => {
      cur.style.transform = \`translate3d(\${e.clientX}px, \${e.clientY}px, 0)\`;
    }, { passive: true });

    window.addEventListener('pointerdown', (e) => {
      cur.classList.add('is-down');
      const r = document.createElement('div');
      r.className = '__sp_ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, { passive: true });

    window.addEventListener('pointerup', () => {
      cur.classList.remove('is-down');
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountCursor);
  } else {
    mountCursor();
  }
})();
`;

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

class SceneRecorder {
  constructor(sceneId, browser) {
    this.sceneId = sceneId;
    this.browser = browser;
    this.events = [];
    this.curX = 720;
    this.curY = 450;
    this.startTime = 0;
  }

  nowMs() {
    return Math.max(0, Math.round(performance.now() - this.startTime));
  }

  log(type, x, y, meta = {}) {
    this.events.push({
      tMs: this.nowMs(),
      type,
      x: Math.round(x),
      y: Math.round(y),
      ...meta,
    });
  }

  async moveSmooth(page, toX, toY, durationMs = 650, arcPx = 28, label = '') {
    const fromX = this.curX;
    const fromY = this.curY;
    const steps = Math.max(12, Math.round(durationMs / 16));
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    this.log('move_start', fromX, fromY, { toX: Math.round(toX), toY: Math.round(toY), durationMs, label });

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = easeInOutCubic(t);
      const arc = Math.sin(t * Math.PI) * arcPx;
      const x = fromX + dx * e + nx * arc;
      const y = fromY + dy * e + ny * arc;
      await page.mouse.move(x, y);
      if (i % 6 === 0) {
        this.log('cursor', x, y);
      }
      await page.waitForTimeout(Math.round(durationMs / steps));
    }
    this.curX = toX;
    this.curY = toY;
    this.log('move_end', toX, toY, { label });
  }

  async clickAt(page, x, y, label = '') {
    await this.moveSmooth(page, x, y, 520, 22, label);
    this.log('click', x, y, { label });
    await page.mouse.down();
    await page.waitForTimeout(70);
    await page.mouse.up();
  }

  async centerOf(page, selector) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 5000 });
    const box = await loc.boundingBox();
    if (!box) return { x: this.curX, y: this.curY };
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  }
}

async function attachRoutes(page, opts = { loggedIn: false, submitStageRef: { current: 'QUE' } }) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();

    const json = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      });

    if (p === '/api/me') {
      if (!opts.loggedIn) return json({ error: 'unauthorized' }, 401);
      return json(MOCK_ME);
    }
    if (p === '/api/status') {
      return json({ queue: 0, workers: 8, etaSec: 1, kolejka: 'online' });
    }
    if (p === '/api/notifications') {
      return json({ items: [{ id: 1, read: false, text: 'Problem C rejudged' }, { id: 2, read: false, text: 'Clarification answered' }] });
    }
    if (p === '/api/contests') {
      return json({ items: MOCK_CONTESTS });
    }
    if (p === '/api/contests/10193118') {
      return json(MOCK_CONTESTS[0]);
    }
    if (p === '/api/contests/10193118/problems') {
      return json({ items: opts.problemsOverride || MOCK_PROBLEMS });
    }
    if (p === '/api/contests/10193118/ranking') {
      return json({
        mode: 'ICPC',
        problems: MOCK_PROBLEMS,
        me: { rank: 2, solved: 4, total: 460 },
        rows: [],
      });
    }
    if (p === '/api/contests/10193118/members') {
      return json({ members: [MOCK_ME], pending: [] });
    }
    if (p === '/api/contests/10193118/clarifications') {
      return json({ items: [] });
    }
    if (p.endsWith('/submit') && method === 'POST') {
      return json({ id: 4092, status: 'QUE', phase: 'QUE' });
    }
    if (p === '/api/submits') {
      return json({
        items: [
          { id: 4092, contestId: 10193118, problemId: 303, status: opts.submitStageRef?.current || 'OK', lang: 'cpp', createdAt: new Date(Date.now() - 12000).toISOString() },
          { id: 4088, contestId: 10193118, problemId: 305, status: 'OK', lang: 'cpp', createdAt: new Date(Date.now() - 720000).toISOString() },
          { id: 4079, contestId: 10193118, problemId: 302, status: 'OK', lang: 'cpp', createdAt: new Date(Date.now() - 1800000).toISOString() },
          { id: 4064, contestId: 10193118, problemId: 306, status: 'WA', lang: 'cpp', createdAt: new Date(Date.now() - 3600000).toISOString() },
        ],
      });
    }
    if (p === '/api/submits/4092') {
      const stage = opts.submitStageRef?.current || 'QUE';
      return json(MOCK_SUBMIT_STAGES[stage] || MOCK_SUBMIT_STAGES.OK);
    }
    return json({});
  });
}

async function recordScene1(browser) {
  console.log('Recording Scene 1: Wave Awakening & Command Switch...');
  const rec = new SceneRecorder('scene1', browser);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    recordVideo: {
      dir: PUBLIC_DIR,
      size: { width: VIEWPORT.width * 2, height: VIEWPORT.height * 2 },
    },
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  await attachRoutes(page, { loggedIn: false });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  rec.startTime = performance.now();

  // Start cursor on left side of water hero and carve a dramatic glowing wave across the FluidRippleBackground
  rec.curX = 280;
  rec.curY = 230;
  await page.mouse.move(rec.curX, rec.curY);
  rec.log('scene_start', rec.curX, rec.curY, { title: 'Guest Wave Hero' });

  // Sweep 1: Carve wide sinusoidal wave wake across upper water grid
  await rec.moveSmooth(page, 1140, 195, 1100, -65, 'wave_sweep_right');
  // Sweep 2: Curve back across the left-center water and drop pulse click in water
  await rec.moveSmooth(page, 460, 310, 850, 55, 'wave_sweep_left');
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  rec.log('click', 460, 310, { label: 'water_pulse_drop' });

  // Sweep 3: Glide across EyebrowFx ("ONLINE JUDGE · ICPC · LABS") to ignite cobalt letter trail
  const eyebrow = await rec.centerOf(page, '.guest-hero .eyebrow-fx');
  await rec.moveSmooth(page, eyebrow.x - 95, eyebrow.y, 480, 20, 'eyebrow_hover_start');
  await rec.moveSmooth(page, eyebrow.x + 100, eyebrow.y, 520, -10, 'eyebrow_hover_sweep');
  await page.waitForTimeout(300);

  // Open Command Palette (Ctrl+K)
  rec.log('focus', 720, 240, { label: 'open_cmdk' });
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(450);

  // Move to Command Palette input and type "XLII UZI" sequentially
  const cmdInput = await rec.centerOf(page, '[role="dialog"] input');
  await rec.moveSmooth(page, cmdInput.x, cmdInput.y, 380, 14, 'cmdk_input');
  rec.log('type', cmdInput.x, cmdInput.y, { text: 'XLII UZI' });
  await page.keyboard.type('XLII UZI', { delay: 50 });
  await page.waitForTimeout(500);

  // Click the top contest result in CmdK
  const firstContest = await rec.centerOf(page, '[role="dialog"] ul li a');
  await rec.clickAt(page, firstContest.x, firstContest.y, 'select_uzi_contest');
  await page.waitForTimeout(600);

  const durationMs = rec.nowMs();
  const videoPath = await page.video().path();
  await context.close();

  const targetPath = path.join(PUBLIC_DIR, 'clip-1.webm');
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  fs.renameSync(videoPath, targetPath);
  console.log(`Scene 1 saved (${durationMs}ms) -> ${targetPath}`);
  return { id: 'scene1', file: 'clip-1.webm', durationMs, events: rec.events };
}

async function recordScene2(browser) {
  console.log('Recording Scene 2: Problem Cockpit & Instant Code Dispatch...');
  const rec = new SceneRecorder('scene2', browser);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    recordVideo: {
      dir: PUBLIC_DIR,
      size: { width: VIEWPORT.width * 2, height: VIEWPORT.height * 2 },
    },
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  await attachRoutes(page, { loggedIn: true });

  await page.goto(`${BASE_URL}/contests/10193118`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.doc-table tbody tr');
  await page.waitForTimeout(300);
  rec.startTime = performance.now();

  rec.curX = 560;
  rec.curY = 210;
  await page.mouse.move(rec.curX, rec.curY);
  rec.log('scene_start', rec.curX, rec.curY, { title: 'Problem Cockpit' });

  // Glide down the Verdict cells (A -> C) to show off the rich telemetry table
  const cellA = await rec.centerOf(page, 'tr[data-row="0"] .vcell-fill');
  await rec.moveSmooth(page, cellA.x, cellA.y, 480, 18, 'hover_verdict_A');
  const cellC = await rec.centerOf(page, 'tr[data-row="2"] .vcell-fill');
  await rec.moveSmooth(page, cellC.x, cellC.y, 520, -15, 'hover_verdict_C_TLE');
  await page.waitForTimeout(450);

  // Move to Submit button on Row 2 (Problem C: Dinic Blocking Flow) and click
  const submitRowBtn = await rec.centerOf(page, 'tr[data-row="2"] button:has-text("Submit")');
  await rec.clickAt(page, submitRowBtn.x, submitRowBtn.y, 'open_submit_modal');
  await page.waitForTimeout(500);

  // Inside Submit Modal: focus CodeMirror editor, insert core C++ structure and type the key line sequentially
  const cmEditor = await rec.centerOf(page, '[role="dialog"] .cm-content');
  await rec.clickAt(page, cmEditor.x - 40, cmEditor.y - 20, 'focus_code_editor');

  await page.keyboard.insertText(
`#include <bits/stdc++.h>
using namespace std;

// O(V^2 E) Planar Blocking Flow — Dual Shortest Augmentation
long long max_planar_flow(int n, int s, int t) {
  Dinic solver(n, s, t);
`
  );
  rec.log('type', cmEditor.x, cmEditor.y, { text: 'return solver.push_blocking_flow();' });
  await page.keyboard.type('  return solver.push_blocking_flow();', { delay: 45 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('}', { delay: 50 });
  await page.waitForTimeout(550);

  // Click the primary Submit (Ctrl+Enter) button in modal footer
  const modalSubmitBtn = await rec.centerOf(page, '[role="dialog"] button.btn-primary');
  await rec.clickAt(page, modalSubmitBtn.x, modalSubmitBtn.y, 'confirm_submit_code');
  await page.waitForTimeout(500);

  // Push live SSE update onto Problem C row in cockpit so it flashes live QUE -> TST!
  await page.evaluate(() => {
    window.__pushSSE({ status: 'TST', phase: 'TST' });
  });
  await page.waitForTimeout(450);

  const durationMs = rec.nowMs();
  const videoPath = await page.video().path();
  await context.close();

  const targetPath = path.join(PUBLIC_DIR, 'clip-2.webm');
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  fs.renameSync(videoPath, targetPath);
  console.log(`Scene 2 saved (${durationMs}ms) -> ${targetPath}`);
  return { id: 'scene2', file: 'clip-2.webm', durationMs, events: rec.events };
}

async function recordScene3(browser) {
  console.log('Recording Scene 3: Sub-Second Live Verdict & Header Wave Dashboard...');
  const rec = new SceneRecorder('scene3', browser);
  const submitStageRef = { current: 'QUE' };

  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    recordVideo: {
      dir: PUBLIC_DIR,
      size: { width: VIEWPORT.width * 2, height: VIEWPORT.height * 2 },
    },
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  await attachRoutes(page, { loggedIn: true, submitStageRef });

  await page.goto(`${BASE_URL}/results/4092`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.submit-card');
  await page.waitForTimeout(250);
  rec.startTime = performance.now();

  const stepper = await rec.centerOf(page, '.submit-steps');
  rec.curX = stepper.x - 220;
  rec.curY = stepper.y;
  await page.mouse.move(rec.curX, rec.curY);
  rec.log('scene_start', rec.curX, rec.curY, { title: 'Live Verdict Stream' });

  // Stage 1: QUE -> CMP (Compiling) at ~350ms
  await page.waitForTimeout(350);
  submitStageRef.current = 'CMP';
  await page.evaluate((payload) => window.__pushSSE(payload), MOCK_SUBMIT_STAGES.CMP);
  rec.log('sse_stage', stepper.x - 80, stepper.y, { stage: 'CMP' });
  await rec.moveSmooth(page, stepper.x - 60, stepper.y, 480, 14, 'stepper_compiling');

  // Stage 2: CMP -> TST (Testing 5/7 live) at ~950ms
  submitStageRef.current = 'TST';
  await page.evaluate((payload) => window.__pushSSE(payload), MOCK_SUBMIT_STAGES.TST);
  rec.log('sse_stage', stepper.x + 60, stepper.y, { stage: 'TST' });
  await rec.moveSmooth(page, stepper.x + 80, stepper.y, 620, -14, 'stepper_testing');
  await page.waitForTimeout(450);

  // Stage 3: TST -> OK (Accepted 7/7 passed · 54ms · 22MB)
  submitStageRef.current = 'OK';
  await page.evaluate((payload) => window.__pushSSE(payload), MOCK_SUBMIT_STAGES.OK);
  rec.log('verdict_landed', stepper.x + 210, stepper.y - 25, { stage: 'OK' });
  await rec.moveSmooth(page, stepper.x + 220, stepper.y - 20, 480, 16, 'stepper_judged_ok');
  await page.waitForTimeout(500);

  // Sweep down across the freshly populated emerald OK test rows (1a -> 3b -> 4a)
  const testRow2 = await rec.centerOf(page, 'table tbody tr:nth-child(2) .vcell-fill');
  await rec.moveSmooth(page, testRow2.x + 110, testRow2.y, 580, 24, 'inspect_test_1b');
  const testRow6 = await rec.centerOf(page, 'table tbody tr:nth-child(6) .vcell-fill');
  await rec.moveSmooth(page, testRow6.x + 110, testRow6.y, 620, -18, 'inspect_test_3b');
  await page.waitForTimeout(650);

  const durationMs = rec.nowMs();
  const videoPath = await page.video().path();
  await context.close();

  const targetPath = path.join(PUBLIC_DIR, 'clip-3.webm');
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
  fs.renameSync(videoPath, targetPath);
  console.log(`Scene 3 saved (${durationMs}ms) -> ${targetPath}`);
  return { id: 'scene3', file: 'clip-3.webm', durationMs, events: rec.events };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const s1 = await recordScene1(browser);
    const s2 = await recordScene2(browser);
    const s3 = await recordScene3(browser);

    const metadata = {
      recordedAt: new Date().toISOString(),
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      scenes: [s1, s2, s3],
    };

    const metaPath = path.join(PUBLIC_DIR, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    const rootMetaPath = path.join(__dirname, '..', 'metadata.json');
    fs.writeFileSync(rootMetaPath, JSON.stringify(metadata, null, 2));
    console.log(`Metadata written to ${metaPath} and ${rootMetaPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
