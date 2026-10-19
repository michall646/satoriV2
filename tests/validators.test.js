// Validators: AAA, positive+negative per behavior.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateFilename, validateLogin, detectLanguage, sanitizeFilename } = require('../apps/api/src/lib/validators');

test('filename accepts safe names (positive)', () => {
  // Arrange
  const name = 'solution.cpp';
  // Act
  const r = validateFilename(name);
  // Assert
  assert.equal(r.ok, true);
});

test('filename rejects spaces with suggestion (negative)', () => {
  // Arrange
  const name = 'my solution (1).cpp';
  // Act
  const r = validateFilename(name);
  // Assert
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'FILENAME_CHARSET');
  assert.match(r.error.hint, /Suggested/);
  assert.equal(sanitizeFilename(name), 'my_solution_1.cpp');
});

test('login accepts valid (positive)', () => {
  assert.equal(validateLogin('jan_kowalski').ok, true);
});

test('login rejects uppercase/short (negative)', () => {
  assert.equal(validateLogin('Jan').ok, false);
  assert.equal(validateLogin('ab').ok, false);
});

test('language auto-detect (positive)', () => {
  assert.equal(detectLanguage('a.cpp'), 'C++17');
  assert.equal(detectLanguage('Main.java'), 'Java');
  assert.equal(detectLanguage('sol.py'), 'Python');
  assert.equal(detectLanguage('x.rs'), 'Rust');
});

test('language override wins (positive)', () => {
  assert.equal(detectLanguage('a.cpp', 'Python'), 'Python');
});
