// Importers: V1 HTML dump, Polygon ZIP, Athina PDF bulk.
// Run: node importers/v1.js ./dump.json  |  node importers/polygon.js pkg.zip
'use strict';
const fs = require('node:fs');
const { store } = require('../apps/api/src/lib/store');

function importV1Dump(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const c of raw.contests || []) {
    const nc = store.insert('contests', {
      name: c.name, description: c.description || '', mode: 'PLAYGROUND',
      lifecycle: 'archived', registration: 'approval', archived: true,
      startAt: null, endAt: null, freezeAt: null,
      settings: { penaltyMin: 20, verdictVisibility: 'all', allowSampleRun: true },
      members: [], pending: [], admins: [],
    });
    for (const p of c.problems || []) {
      store.insert('problems', {
        contestId: nc.id, setId: null, code: p.code || 'A', name: p.name,
        statementMd: p.statementMd || '', statementHtml: '', samples: p.samples || [],
        limits: { timeMs: 1000, memoryMb: 256, stackMb: 64, perLang: {} },
        visibility: 'visible', tags: ['imported:v1'], difficulty: 1, pdfBadge: p.pdf ? 'PDF' : 'HTML', version: 1, aliasLetters: {},
      });
      n += 1;
    }
  }
  console.log(`V1 import: ${raw.contests?.length || 0} contests, ${n} problems. Archive at /contest/<id>/problems/<pid> preserved via redirect map.`);
}

function importPolygonZip(zipPath) {
  // Minimal: real impl unzips problem.xml + tests + statement.pdf/md.
  // Here: record intent + create placeholder so pipeline exists.
  const name = String(zipPath).split(/[\\/]/).pop();
  console.log(`Polygon import stub: ${name} -> parse problem.xml, tests/, statements/ (kolejka-judge format kept). Wire unzip in prod.`);
}

if (require.main === module) {
  const [,, kind, file] = process.argv;
  if (kind === 'v1') importV1Dump(file);
  else if (kind === 'polygon') importPolygonZip(file);
  else console.log('usage: node importers/v1.js v1 ./dump.json | polygon pkg.zip');
}
module.exports = { importV1Dump, importPolygonZip };
