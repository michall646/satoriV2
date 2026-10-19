#!/usr/bin/env node
// Satori V2 official CLI — absorbs zielmicha/mhorod/dominik-korsa/MasFlam UX.
// No scraping: token auth, problem URL in comment, --open --ci.
// Usage:
//   satori login --login jan --password x
//   satori contests
//   satori problems [--contest 251519]
//   satori submit solution.cpp --contest 251519 [--problem A] [--open] [--ci]
//   satori status 123 [--watch]
//   satori results [--contest 1] [--limit 50] [--offset 0] [--all]
// Token resolution: --token <jwt> > SATORI_TOKEN > ~/.satori-token (token + refresh).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Satori } = require('./sdk-shim');

const API = process.env.SATORI_API || 'http://localhost:3001';
const WEB = process.env.SATORI_WEB || 'http://localhost:3000';
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const TOKEN_FILE = path.join(HOME, '.satori-token');
const BOOLEAN_FLAGS = new Set(['open', 'ci', 'watch', 'help', 'all', 'json', 'me']);

function parseArgs(argv = []) {
  const flags = Object.create(null);
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (!token.startsWith('--')) {
      if (token !== '-') rest.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq > 2) { flags[token.slice(2, eq)] = token.slice(eq + 1); continue; }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = true; continue; }
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) { flags[name] = next; i++; continue; }
    flags[name] = true;
  }
  return { command: rest.shift() || null, flags, rest };
}

function readSession(file = TOKEN_FILE) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return { token: null, refresh: null };
    if (raw.startsWith('{')) {
      const data = JSON.parse(raw);
      return { token: data.token || null, refresh: data.refresh || null };
    }
    // Legacy file: a bare token.
    return { token: raw, refresh: null };
  } catch {
    return { token: null, refresh: null };
  }
}

function writeSession(session, file = TOKEN_FILE) {
  fs.writeFileSync(file, JSON.stringify({ token: session.token || null, refresh: session.refresh || null }), { mode: 0o600 });
}

// Pure precedence helper, exported for tests.
function pickToken({ flag, env, session } = {}) {
  if (flag && flag !== true) return { token: String(flag), source: 'flag' };
  if (env) return { token: String(env), source: 'env' };
  if (session && session.token) return { token: session.token, source: 'file' };
  return { token: null, source: 'none' };
}

function openUrl(url, opts = {}) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  const platform = opts.platform || process.platform;
  const interactive = opts.interactive !== undefined
    ? opts.interactive
    : Boolean(process.stdout.isTTY) && !process.env.CI;
  if (!interactive) return false;
  let cmd;
  let args;
  if (platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
  else if (platform === 'darwin') { cmd = 'open'; args = [url]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function die(message) {
  console.error(message);
  process.exitCode = 1;
  return null;
}

function commentFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.py') return '#';
  if (ext === '.sql') return '--';
  return '//';
}

async function main(argv = process.argv.slice(2)) {
  const { command: cmd, flags, rest } = parseArgs(argv);
  const value = (name) => (typeof flags[name] === 'string' ? flags[name] : null);
  const has = (name) => Boolean(flags[name]);
  const fileSession = readSession();
  const picked = pickToken({ flag: flags.token, env: process.env.SATORI_TOKEN, session: fileSession });
  const cli = new Satori(API, picked.token, {
    // A token from --token/SATORI_TOKEN is not tied to the saved refresh token.
    refresh: picked.source === 'file' ? fileSession.refresh : null,
    onSession: (session) => { try { writeSession(session); } catch { /* read-only home */ } },
  });

  if (!cmd || cmd === 'help' || has('help')) {
    console.log('commands: login, contests, problems [--contest ID], submit FILE --contest ID [--problem A] [--open] [--ci|--watch], status ID [--watch], watch ID, results [--contest ID] [--limit N] [--offset N] [--all], details ID');
    return;
  }

  if (cmd === 'login') {
    const login = value('login');
    const password = value('password');
    if (!login || !password) return die('need --login L --password P');
    const d = await cli.login(login, password, { device: 'cli' });
    process.env.SATORI_TOKEN = d.token;
    console.log('logged in, token saved');
    return;
  }

  if (cmd === 'contests') {
    const d = await cli.contests();
    if (has('json')) return console.log(JSON.stringify(d, null, 2));
    for (const c of d.items) console.log(`${c.id}\t${c.name}\t${c.mode}\t${c.lifecycle}`);
    return;
  }

  if (cmd === 'problems') {
    const contestId = value('contest');
    if (contestId) {
      const d = await cli.problems(contestId);
      if (has('json')) return console.log(JSON.stringify(d, null, 2));
      for (const p of d.items) console.log(`${p.code}\t${p.name}\t${p._best || '-'}\t${p._tries || 0}`);
      return;
    }
    const d = await cli.allProblems();
    if (!d.items.length) {
      return die('No visible problems found. Pass --contest <id> or log in with `satori login`.');
    }
    if (has('json')) return console.log(JSON.stringify(d, null, 2));
    for (const p of d.items) console.log(`${p.contestId}\t${p.code}\t${p.name}\t${p._best || '-'}\t${p._tries || 0}`);
    return;
  }

  if (cmd === 'submit') {
    const file = rest[0];
    if (!file) return die('need solution.cpp');
    let code;
    try { code = fs.readFileSync(file, 'utf8'); } catch (e) { return die(`cannot read ${file}: ${e.message}`); }
    // dominik-korsa UX: problem URL may live in the source comment.
    const m = code.match(/satori.*?contest\/(\d+).*problems\/(\d+)/i);
    const contest = value('contest') || (m && m[1]);
    const problem = value('problem-id') || value('problem') || (m && m[2]) || undefined;
    const marker = commentFor(file);
    const urlComment = contest && problem ? `${marker} ${API}/contest/${contest}/problems/${problem}\n` : '';
    const s = await cli.submit({
      contestId: contest,
      problemId: problem,
      code: urlComment + code,
      filename: path.basename(file),
      lang: value('lang') || undefined,
    });
    const queue = s.queue || {};
    console.log(`submit #${s.id} ${s.status} queue=${queue.position ?? '?'} eta=${queue.etaSec ?? '?'}s`);
    if (has('open')) {
      const url = `${WEB.replace(/\/$/, '')}/results/${s.id}`;
      const opened = openUrl(url);
      console.log(opened ? `opened ${url}` : `open this URL: ${url}`);
    }
    if (has('ci') || has('watch')) await cli.watch(s.id);
    return;
  }

  if (cmd === 'status' || cmd === 'details') {
    const id = rest[0];
    if (!id) return die(`need submit id: satori ${cmd} <id>`);
    if (has('watch')) { await cli.watch(id); return; }
    const d = await cli.submitStatus(id);
    console.log(JSON.stringify(d, null, 2));
    return;
  }

  if (cmd === 'watch') {
    const id = rest[0];
    if (!id) return die('need submit id: satori watch <id>');
    await cli.watch(id);
    return;
  }

  if (cmd === 'results') {
    const limit = Math.max(1, Math.min(Number(value('limit') || 50), 1000));
    let offset = Math.max(0, Number(value('offset') || 0));
    for (;;) {
      const d = await cli.results({
        contest: value('contest'),
        problem: value('problem'),
        verdict: value('verdict'),
        me: has('me'),
        team: value('team'),
        limit,
        offset,
      });
      if (has('json')) return console.log(JSON.stringify(d, null, 2));
      for (const s of d.items) console.log(`#${s.id} p${s.problemId} ${s.status} ${s.lang} ${s.createdAt}`);
      offset += d.items.length;
      if (!has('all') || !d.items.length || offset >= (d.total || 0)) break;
    }
    return;
  }

  return die(`unknown ${cmd}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String((e && e.message) || e));
    process.exitCode = 1;
  });
}

module.exports = { API, WEB, TOKEN_FILE, parseArgs, pickToken, readSession, writeSession, openUrl, main };
