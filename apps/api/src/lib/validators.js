// Satori V2 — validators. No silent failures: every reject carries fix hint.
'use strict';

const LOGIN_RE = /^[a-z0-9_]{3,24}$/;
const FILENAME_SAFE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BASENAME_RE = /[^A-Za-z0-9_-]+/g;

function fail(code, message, hint, field) {
  return { ok: false, error: { code, message, hint, field } };
}

function validateLogin(login) {
  if (!login) return fail('LOGIN_REQUIRED', 'Login required.', 'Use 3-24 chars: a-z 0-9 _.', 'login');
  if (!LOGIN_RE.test(login)) return fail('LOGIN_INVALID', `Login "${login}" invalid.`, 'Use 3-24 chars: a-z 0-9 _, e.g. jan_kowalski.', 'login');
  return { ok: true };
}

function validateEmail(email) {
  if (!email) return fail('EMAIL_REQUIRED', 'E-mail required.', 'Provide a valid e-mail, e.g. jan@uj.edu.pl.', 'email');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('EMAIL_INVALID', 'E-mail invalid.', 'Check for @ and domain.', 'email');
  return { ok: true };
}

// V1 2013 rule: only [A-Za-z0-9] — V2 keeps strictness but explains + suggests.
function sanitizeFilename(name) {
  if (!name) return 'solution.cpp';
  const base = String(name).split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  const cleanStem = stem.replace(BASENAME_RE, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'solution';
  const cleanExt = ext.replace(/[^A-Za-z0-9.]/g, '').slice(0, 10);
  return `${cleanStem}${cleanExt}`;
}

function validateFilename(name) {
  if (!name) return fail('FILENAME_REQUIRED', 'Filename required.', 'Name your file, e.g. solution.cpp.', 'filename');
  const base = String(name).split(/[\\/]/).pop();
  if (FILENAME_SAFE_RE.test(base)) return { ok: true };
  return fail(
    'FILENAME_CHARSET',
    `Filename "${base}" uses disallowed characters.`,
    `Use only A-Z a-z 0-9 . _ -. Suggested: ${sanitizeFilename(base)}`,
    'filename'
  );
}

const EXT_LANG = {
  '.c': 'C', '.h': 'C',
  '.cpp': 'C++17', '.cc': 'C++17', '.cxx': 'C++17',
  '.java': 'Java', '.py': 'Python', '.rs': 'Rust',
  '.sql': 'SQL', '.cu': 'CUDA', '.js': 'JavaScript',
};

function detectLanguage(filename, override) {
  if (override) return override;
  if (!filename) return 'C++17';
  const dot = String(filename).lastIndexOf('.');
  if (dot < 0) return 'C++17';
  const ext = String(filename).slice(dot).toLowerCase();
  return EXT_LANG[ext] || 'C++17';
}

const LANGUAGES = ['C', 'C++17', 'Java', 'Python', 'Rust', 'JavaScript'];

module.exports = { validateLogin, validateEmail, validateFilename, sanitizeFilename, detectLanguage, LANGUAGES };
