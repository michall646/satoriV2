#!/usr/bin/env node
// Satori V2 official CLI — absorbs zielmicha/mhorod/dominik-korsa/MasFlam UX.
// No scraping: token auth, problem URL in comment, --open --ci.
// Usage:
//   satori login --login jan --password x
//   satori contests
//   satori problems --contest 251519
//   satori submit solution.cpp --contest 251519 [--problem A] [--open] [--ci]
//   satori status 123 --watch
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Satori } = require('./sdk-shim');

const API = process.env.SATORI_API || 'http://localhost:3001';
const TOKEN_FILE = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.satori-token');
function saveToken(t) { fs.writeFileSync(TOKEN_FILE, t); }
function loadToken() {
  if (process.env.SATORI_TOKEN) return process.env.SATORI_TOKEN;
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return null; }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cli = new Satori(API, loadToken());
  const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] || true : null; };
  const has = (n) => rest.includes(n);
  if (!cmd || cmd === 'help') return console.log('commands: login, contests, problems, submit, status, results, details, pdf, watch');
  if (cmd === 'login') {
    const login = flag('--login');
    const password = flag('--password');
    if (!login || !password) return console.error('need --login L --password P');
    const d = await cli.login(login, password);
    saveToken(d.token);
    process.env.SATORI_TOKEN = d.token;
    return console.log('logged in, token saved');
  }
  if (cmd === 'contests') {
    const d = await cli.contests();
    for (const c of d.items) console.log(`${c.id}\t${c.name}\t${c.mode}\t${c.lifecycle}`);
    return;
  }
  if (cmd === 'problems') {
    const cid = flag('--contest');
    const d = await cli.problems(cid);
    for (const p of d.items) console.log(`${p.code}\t${p.name}\t${p._best || '-'}\t${p._tries || 0}`);
    return;
  }
  if (cmd === 'submit') {
    const file = rest.find((a) => !a.startsWith('--') && !a.startsWith('-'));
    if (!file) return console.error('need file.cpp');
    const code = fs.readFileSync(file, 'utf8');
    // dominik-korsa UX: problem URL may live in source comment
    const m = code.match(/satori.*?contest\/(\d+).*problems\/(\d+)/i);
    const contest = flag('--contest') || (m && m[1]);
    const codeWithUrl = `// ${API}/contest/${contest}/problems/${flag('--problem') || ''}\n${code}`;
    const s = await cli.submit({ contestId: contest, problemId: flag('--problem-id') || flag('--problem') || (m && m[2]) || undefined, code: codeWithUrl, filename: path.basename(file), lang: flag('--lang') || undefined });
    console.log(`submit #${s.id} ${s.status} queue=${s.queue.position} eta=${s.queue.etaSec}s`);
    if (has('--open')) console.log(`${API}/api/submits/${s.id}`);
    if (has('--ci') || has('--watch')) await cli.watch(s.id);
    return;
  }
  if (cmd === 'status' || cmd === 'details') {
    const id = rest[0];
    const d = await cli.submitStatus(id);
    console.log(JSON.stringify(d, null, 2));
    return;
  }
  if (cmd === 'results') {
    const d = await cli.results({ contest: flag('--contest'), problem: flag('--problem'), limit: flag('--limit') || 20 });
    for (const s of d.items) console.log(`#${s.id} p${s.problemId} ${s.status} ${s.lang} ${s.createdAt}`);
    return;
  }
  console.error(`unknown ${cmd}`);
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
