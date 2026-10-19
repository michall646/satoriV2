// Judge checkers + integrity: AAA, positive+negative.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkOutput, simulate } = require('../packages/judge/src/judge');
const { similarityGraph } = require('../apps/api/src/lib/integrity');

test('token checker ignores whitespace (positive)', () => {
  assert.equal(checkOutput('token', '5\n', '  5  \n'), true);
});

test('token checker fails on wrong (negative)', () => {
  assert.equal(checkOutput('token', '5\n', '6\n'), false);
});

test('float checker tolerates epsilon (positive)', () => {
  assert.equal(checkOutput('float', '0.333333\n', '0.333334\n'), true);
});

test('float checker fails outside tol (negative)', () => {
  assert.equal(checkOutput('float', '1.0\n', '2.0\n'), false);
});

test('simulate sums samples (positive)', () => {
  assert.equal(simulate('int main(){a+b;}', 'C++17', '2 3\n'), '5\n');
});

test('similarity flags near-copies (positive)', () => {
  const code = 'int main() { int a = 1; int b = 2; int c = 3; int d = 4; int e = 5; return a+b+c+d+e; }';
  const g = similarityGraph([{ id: 1, code }, { id: 2, code }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].flag, 'high');
});

test('similarity ignores distinct (negative)', () => {
  const g = similarityGraph([{ id: 1, code: 'aaa bbb ccc ddd eee fff ggg' }, { id: 2, code: 'zzz yyy xxx www vvv uuu ttt' }]);
  assert.equal(g.length, 0);
});
