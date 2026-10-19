'use client';
import { useEffect, useRef } from 'react';

// Decorative "water" background: a monospace glyph grid driven by a damped wave
// simulation. Rendered to a single <canvas> inside the dirty bounding box only,
// which keeps DOM/style work at zero per frame.

const PHRASE = 'STILL WATER HOLDS THE SHAPE OF EVERY THOUGHT UNTIL MOVED BY HAND OR WIND · SUBMIT CODE WATCH THE VERDICT LAND · ';

const DAMPING = 0.82;
const DECAY = 0.012;
const SNAP = 0.08;
const TURB_DECAY = 0.74;
const WAKE_R = 1.8;

const MAX_DPR = 1.5;            // background fidelity cap — avoids huge buffers on retina
const FRAME_MS = 1000 / 40;     // ~40fps cap; rAF fires faster on 90/120Hz panels
const IDLE_RIPPLE_MS = 3600;    // touch devices get a gentle idle swell (no hover there)
const MAX_STEPS = 24;           // cap pointer interpolation on fast jumps
const QUEUE_MAX = 32;           // most recent coalesced touch points kept per frame

const TIER_CHAR = ['', '░', '▒', '▓', '█'];

function isCoarse() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || false;
}

// Fewer, larger cells on phones/tablets/low-core machines = less work per frame.
function cellSize() {
  if (typeof window === 'undefined') return { w: 16, h: 23 };
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4;
  const narrow = window.innerWidth < 900;
  if (lowEnd || narrow) return { w: 20, h: 28 };
  return { w: 16, h: 23 };
}

function tierOf(energy) {
  if (energy < 0.18) return 0;
  if (energy <= 0.42) return 1;
  if (energy <= 0.85) return 2;
  if (energy <= 1.45) return 3;
  return 4;
}

export default function FluidRippleBackground({ variant = 'hero' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof window === 'undefined') return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasTouchEvents = 'ontouchstart' in window;
    const st = {
      variant, el, ctx, reduced, live: true, onscreen: true,
      cols: 0, rows: 0, C: 0, R: 0, N: 0, w: 16, h: 23, dpr: 1, cssW: 0, cssH: 0,
      curr: null, prev: null, turb: null, box: null, last: 0, raf: 0,
      timer: 0, idle: 0, idleKick: 0, downX: null, downY: null,
      lastX: null, lastY: null, colors: null, font: '', coarse: isCoarse(),
      queue: [], touch: false,
    };

    buildGrid(st);

    function inBand(py) {
      return py >= 0 && py <= st.rows * st.h;
    }
    function pageY(e) {
      return e.clientY + window.scrollY;
    }
    function enqueue(x, y) {
      if (!inBand(y)) {
        st.lastX = x;
        st.lastY = y;
        return false;
      }
      const q = st.queue;
      q.push({ x, y });
      if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
      return true;
    }

    // Touch is a gesture, not a mouse. The trail is anchored per gesture and
    // torn down on release, so one swipe never draws a line to the next tap.
    function beginSwipe(x, y) {
      st.touch = true;
      st.queue.length = 0;
      st.lastX = x;
      st.lastY = y;
      if (!inBand(y)) return;
      st.downX = x;
      st.downY = y;
      wake(st);
    }
    // A browser may advertise touch events yet still deliver touch input only
    // as pointer events; until a real touch event arrives, pointer events stay
    // authoritative for touch.
    let sawTouchEvent = false;
    function touchEventsWin() {
      return hasTouchEvents && sawTouchEvent;
    }

    function swipePoint(x, y) {
      if (!st.touch) return;
      enqueue(x, y);
      wake(st);
    }
    function endSwipe() {
      st.touch = false;
      st.queue.length = 0;
      st.lastX = null;
      st.lastY = null;
    }

    // Touch events, not pointer events, drive touch input: a swipe that starts
    // scrolling makes the browser fire pointercancel and stop the pointer
    // stream entirely, which killed the wake mid-swipe. Passive touchmove keeps
    // arriving while the page scrolls, so the trail follows the finger.
    function onTouchStart(e) {
      sawTouchEvent = true;
      const t = e.changedTouches && e.changedTouches[0];
      if (t) beginSwipe(t.clientX, t.clientY + window.scrollY);
    }
    function onTouchMove(e) {
      if (!st.touch) return;
      const list = e.changedTouches;
      if (!list) return;
      for (let i = 0; i < list.length; i += 1) {
        swipePoint(list[i].clientX, list[i].clientY + window.scrollY);
      }
    }
    function onTouchEnd(e) {
      if (e.type !== 'touchcancel' && e.touches && e.touches.length > 0) return;  // other fingers down
      endSwipe();
    }

    function onMove(e) {
      if (e.pointerType === 'touch') {
        if (touchEventsWin()) return;                  // handled by touch listeners
        swipePoint(e.clientX, pageY(e));
        return;
      }
      enqueue(e.clientX, pageY(e));
      wake(st);
    }
    function onDown(e) {
      if (e.pointerType === 'touch') {
        if (touchEventsWin()) return;
        beginSwipe(e.clientX, pageY(e));
        return;
      }
      const y = pageY(e);
      if (!inBand(y)) return;
      st.downX = e.clientX;
      st.downY = y;
      wake(st);
    }
    function onUp(e) {
      if (e.pointerType !== 'touch') return;
      if (touchEventsWin()) return;                    // pointercancel must not end a live swipe
      endSwipe();
    }
    function onResize() {
      window.clearTimeout(st.timer);
      st.timer = window.setTimeout(() => buildGrid(st), 180);
    }
    function onVis() {
      if (document.hidden) stop(st);
      else wake(st);
    }

    window.addEventListener('resize', onResize);

    // Reduced motion: draw the static glyph field once, no listeners/loop.
    if (reduced) {
      return () => {
        st.live = false;
        window.clearTimeout(st.timer);
        window.removeEventListener('resize', onResize);
      };
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    if (hasTouchEvents) {
      window.addEventListener('touchstart', onTouchStart, { passive: true });
      window.addEventListener('touchmove', onTouchMove, { passive: true });
      window.addEventListener('touchend', onTouchEnd, { passive: true });
      window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    }
    document.addEventListener('visibilitychange', onVis);

    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((entries) => {
        st.onscreen = entries[0] ? entries[0].isIntersecting : true;
        if (st.onscreen) wake(st);
        else stop(st);
      });
      io.observe(el);
    }

    // Re-read theme colors and repaint the WHOLE field on theme change. The
    // repaint must be unconditional: cells outside the animated box would
    // otherwise keep the previous theme's colors forever.
    function recolor() {
      refreshStyle(st);
      drawAllRest(st);
    }

    let mo = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(recolor);
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'style'],
      });
    }

    const scheme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (scheme && scheme.addEventListener) scheme.addEventListener('change', recolor);

    // Touch devices never hover, so keep the surface alive on a timer. Spread
    // the swells over the whole field, not just the top band.
    function idleSwell() {
      if (!st.live || !st.onscreen || document.hidden || st.box) return;
      const cx = 3 + Math.random() * Math.max(1, st.cols - 6);
      const cy = 3 + Math.random() * Math.max(1, st.rows - 6);
      inject(st, cx, cy, 0, 0, 2.6);
      wake(st);
    }

    if (st.coarse) {
      st.idle = window.setInterval(idleSwell, IDLE_RIPPLE_MS);
      st.idleKick = window.setTimeout(idleSwell, 700);
    }

    return () => {
      st.live = false;
      stop(st);
      window.clearTimeout(st.timer);
      window.clearInterval(st.idle);
      window.clearTimeout(st.idleKick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      if (io) io.disconnect();
      if (mo) mo.disconnect();
      if (scheme && scheme.removeEventListener) scheme.removeEventListener('change', recolor);
    };
  }, [variant]);

  return (
    <div className={variant === 'hero' ? 'fluid-ripple' : `fluid-ripple fluid-ripple-${variant}`} aria-hidden="true">
      <canvas ref={canvasRef} className="fluid-ripple-grid" />
    </div>
  );
}

function bgHeight(variant, h) {
  if (variant === 'header') {
    const head = document.querySelector('.dash-header');
    if (head) return Math.max(8 * h, head.offsetTop + head.offsetHeight + 24);
    return Math.max(8 * h, 220);
  }
  const hero = document.querySelector('.guest-hero');
  if (hero) return Math.max(8 * h, hero.offsetHeight);
  return Math.round(window.innerHeight * 0.6);
}

function refreshStyle(st) {
  const cs = getComputedStyle(st.el);
  const fam = cs.fontFamily || 'ui-monospace, monospace';
  st.font = `${Math.round(st.w * 0.72)}px ${fam}`;
  const read = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  st.colors = {
    rest: read('--ripple-rest', '#c3cad4'),
    soft: read('--ripple-soft', '#93c5fd'),
    mid: read('--ripple-mid', '#60a5fa'),
    hot: read('--ripple-hot', '#2563eb'),
  };
}

function buildGrid(st) {
  const { w, h } = cellSize();
  st.w = w;
  st.h = h;
  refreshStyle(st);

  st.cols = Math.max(10, Math.ceil(window.innerWidth / w));
  st.rows = Math.max(8, Math.ceil(bgHeight(st.variant, h) / h));
  // Pad the field by one zero cell on every side so the wave can reach the
  // outermost row/column without reading out of bounds. Simulated domain is
  // x: 1..cols, y: 1..rows in padded coordinates.
  st.C = st.cols + 2;
  st.R = st.rows + 2;
  st.N = st.C * st.R;
  st.curr = new Float32Array(st.N);
  st.prev = new Float32Array(st.N);
  st.turb = new Float32Array(st.N);
  st.box = null;
  st.last = 0;
  st.lastX = null;
  st.lastY = null;
  st.queue.length = 0;
  st.touch = false;
  st.downX = null;
  st.downY = null;

  const cssW = st.cols * w;
  const cssH = st.rows * h;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  st.dpr = dpr;
  st.cssW = cssW;
  st.cssH = cssH;
  st.el.style.width = `${cssW}px`;
  st.el.style.height = `${cssH}px`;
  st.el.width = Math.round(cssW * dpr);
  st.el.height = Math.round(cssH * dpr);

  // Setting width/height resets all context state — reapply it here.
  const ctx = st.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = st.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  drawAllRest(st);
}

function drawAllRest(st) {
  const { ctx, cols, rows, w, h, colors } = st;
  ctx.clearRect(0, 0, st.cssW, st.cssH);
  ctx.fillStyle = colors.rest;
  const cy = h / 2;
  for (let y = 0; y < rows; y += 1) {
    const off = y * cols;
    const py = y * h + cy;
    for (let x = 0; x < cols; x += 1) {
      ctx.fillText(PHRASE[(off + x) % PHRASE.length], x * w + w / 2, py);
    }
  }
}

function pushPoint(st, px, py, force) {
  if (!st.curr) return;
  const w = st.w;
  const h = st.h;
  if (py < 0 || py > st.rows * h) {
    st.lastX = px;
    st.lastY = py;
    return;
  }
  if (st.lastX === null) {
    inject(st, px / w, py / h, 1, 0, force || 6);
    st.lastX = px;
    st.lastY = py;
    return;
  }
  const dx = px - st.lastX;
  const dy = py - st.lastY;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.5 && force == null) return;
  const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(dist / (w * 0.45))));
  for (let s = 1; s <= steps; s += 1) {
    inject(st, (st.lastX + (dx * s) / steps) / w, (st.lastY + (dy * s) / steps) / h, dx, dy, force || dist);
  }
  st.lastX = px;
  st.lastY = py;
}

function inject(st, cx, cy, vx, vy, speed) {
  if (!st.curr) return;
  const px = cx + 1;   // padded coordinates
  const py = cy + 1;
  const r = Math.min(2.6, WAKE_R + (speed || 0) * 0.015);
  const rc = Math.ceil(r);
  const mag = Math.hypot(vx, vy) || 1;
  const nvx = vx / mag;
  const nvy = vy / mag;
  const x0 = Math.max(1, Math.floor(px - rc));
  const x1 = Math.min(st.cols, Math.ceil(px + rc));
  const y0 = Math.max(1, Math.floor(py - rc));
  const y1 = Math.min(st.rows, Math.ceil(py + rc));
  const amp = Math.min(2.2, 0.9 + (speed || 0) * 0.05);
  const C = st.C;
  for (let gy = y0; gy <= y1; gy += 1) {
    for (let gx = x0; gx <= x1; gx += 1) {
      const ddx = gx - px;
      const ddy = gy - py;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist >= r) continue;
      const fall = Math.pow(1 - dist / r, 2.2);
      const dot = (ddx * nvx + ddy * nvy) / (dist || 1);
      const i = gy * C + gx;
      st.curr[i] += fall * (0.95 + dot * 0.45) * amp;
      const t = st.turb[i] + fall * 1.15;
      st.turb[i] = t > 2.5 ? 2.5 : t;
    }
  }
  growBox(st, x0, y0, x1, y1);
}

function growBox(st, x0, y0, x1, y1) {
  if (!st.box) {
    st.box = { x0, y0, x1, y1 };
    return;
  }
  const b = st.box;
  if (x0 < b.x0) b.x0 = x0;
  if (y0 < b.y0) b.y0 = y0;
  if (x1 > b.x1) b.x1 = x1;
  if (y1 > b.y1) b.y1 = y1;
}

function stop(st) {
  window.cancelAnimationFrame(st.raf);
  st.raf = 0;
}

function wake(st) {
  if (!st.live || st.reduced || !st.onscreen || document.hidden || st.raf) return;
  st.last = 0;
  st.raf = window.requestAnimationFrame((t) => tick(st, t));
}

function tick(st, now) {
  st.raf = 0;
  if (!st.live || !st.curr) return;

  // Tap/click splash first, then the queued trail so the wake connects.
  if (st.downX !== null) {
    pushPoint(st, st.downX, st.downY, 14);
    st.downX = null;
    st.downY = null;
  }
  if (st.queue.length) {
    const q = st.queue;
    for (let i = 0; i < q.length; i += 1) pushPoint(st, q[i].x, q[i].y);
    q.length = 0;
  }

  if (!st.box) return;

  // Frame cap: skip ticks that arrive faster than the target rate.
  if (st.last && now - st.last < FRAME_MS) {
    st.raf = window.requestAnimationFrame((t) => tick(st, t));
    return;
  }
  st.last = now;

  const { cols, rows, C, curr, prev, turb, ctx, w, h, colors } = st;
  const b = st.box;
  if (b.x0 > 1) b.x0 -= 1;
  if (b.y0 > 1) b.y0 -= 1;
  if (b.x1 < cols) b.x1 += 1;
  if (b.y1 < rows) b.y1 += 1;

  // Only the dirty band is cleared and redrawn (padded coords -> pixels).
  ctx.clearRect((b.x0 - 1) * w, (b.y0 - 1) * h, (b.x1 - b.x0 + 1) * w, (b.y1 - b.y0 + 1) * h);

  // Pass 1 — advance the wave and decay turbulence.
  for (let y = b.y0; y <= b.y1; y += 1) {
    const off = y * C;
    for (let x = b.x0; x <= b.x1; x += 1) {
      const i = off + x;
      const sum = curr[i - 1] + curr[i + 1] + curr[i - C] + curr[i + C];
      let next = (sum * 0.5 - prev[i]) * DAMPING;
      if (next > 0) next = next > DECAY ? next - DECAY : 0;
      else if (next < 0) next = next < -DECAY ? next + DECAY : 0;
      if (next < SNAP && next > -SNAP) next = 0;
      prev[i] = next;
      const t = turb[i] * TURB_DECAY;
      turb[i] = t < 0.02 ? 0 : t;
    }
  }
  st.curr = prev;
  st.prev = curr;

  // Pass 2 — render the band, batching fillStyle changes by tier.
  const H = st.curr;
  const halfW = w / 2;
  const halfH = h / 2;
  let active = 0;
  let lastColor = '';
  for (let y = b.y0; y <= b.y1; y += 1) {
    const off = y * C;
    const py = (y - 1) * h + halfH;
    for (let x = b.x0; x <= b.x1; x += 1) {
      const i = off + x;
      const gx = H[i + 1] - H[i - 1];
      const gy = H[i + C] - H[i - C];
      const energy = Math.abs(H[i]) + Math.sqrt(gx * gx + gy * gy) * 0.325 + turb[i] * 0.9;
      const tier = tierOf(energy);
      let color;
      let ch;
      if (tier === 0) {
        color = colors.rest;
        ch = PHRASE[((y - 1) * cols + (x - 1)) % PHRASE.length];
      } else {
        active += 1;
        ch = TIER_CHAR[tier];
        color = tier <= 1 ? colors.soft : tier <= 2 ? colors.mid : colors.hot;
      }
      if (color !== lastColor) {
        ctx.fillStyle = color;
        lastColor = color;
      }
      ctx.fillText(ch, (x - 1) * w + halfW, py);
    }
  }

  if (active > 0) st.raf = window.requestAnimationFrame((t) => tick(st, t));
  else st.box = null;
}
