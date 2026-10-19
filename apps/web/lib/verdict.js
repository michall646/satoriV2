// Satori V2 web — verdict + filename helpers.

const VERDICT_CLASS = {
  OK: 'verdict verdict-OK', ANS: 'verdict verdict-ANS', WA: 'verdict verdict-WA',
  TLE: 'verdict verdict-TLE', MLE: 'verdict verdict-MLE', RE: 'verdict verdict-RE',
  CE: 'verdict verdict-CE', QUE: 'verdict verdict-QUE', CMP: 'verdict verdict-CMP', TST: 'verdict verdict-TST',
};

const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function suggestFilename(name) {
  if (!name) return 'solution.cpp';
  let s = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '');
  if (!s) return 'solution.cpp';
  return s;
}

module.exports = { VERDICT_CLASS, FILENAME_RE, suggestFilename };
