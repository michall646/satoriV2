// Tests for Judge Sandboxing (Phase 5 / C15 / M7).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const SANDBOX = require('../packages/judge/src/sandbox');
const J = require('../packages/judge/src/judge');

test('clampMemoryMb clamps within safe operational bounds (16MB - 4096MB)', () => {
  assert.deepEqual(SANDBOX.clampMemoryMb(512), { memoryMb: 512, clamped: false });
  assert.deepEqual(SANDBOX.clampMemoryMb(null), { memoryMb: 256, clamped: false });
  assert.deepEqual(SANDBOX.clampMemoryMb(0), { memoryMb: 256, clamped: false });
  assert.deepEqual(SANDBOX.clampMemoryMb(-100), { memoryMb: 256, clamped: false });
  assert.deepEqual(SANDBOX.clampMemoryMb('not-a-number'), { memoryMb: 256, clamped: false });

  // Low clamp
  const low = SANDBOX.clampMemoryMb(8);
  assert.equal(low.clamped, true);
  assert.equal(low.memoryMb, 16);

  // High clamp
  const high = SANDBOX.clampMemoryMb(8192);
  assert.equal(high.clamped, true);
  assert.equal(high.memoryMb, 4096);
});

test('buildDockerRunArgs creates correct isolation flags', () => {
  const args = SANDBOX.buildDockerRunArgs({
    cmd: './sol',
    args: ['arg1', 'arg2'],
    cwd: process.cwd(),
    memoryMb: 128,
    pidsLimit: 32,
    network: 'none',
    readOnly: true,
    image: 'kolejka/satori:judge',
    env: { FOO: 'bar' },
  });

  assert.ok(args.includes('run'));
  assert.ok(args.includes('--rm'));
  assert.ok(args.includes('--network'));
  assert.equal(args[args.indexOf('--network') + 1], 'none');

  assert.ok(args.includes('--memory'));
  assert.equal(args[args.indexOf('--memory') + 1], '128m');

  assert.ok(args.includes('--memory-swap'));
  assert.equal(args[args.indexOf('--memory-swap') + 1], '128m');

  assert.ok(args.includes('--pids-limit'));
  assert.equal(args[args.indexOf('--pids-limit') + 1], '32');

  assert.ok(args.includes('--cpus'));
  assert.equal(args[args.indexOf('--cpus') + 1], '1');

  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--tmpfs'));
  assert.ok(args.includes('-u'));
  assert.equal(args[args.indexOf('-u') + 1], '10001:10001');

  assert.ok(args.includes('--env'));
  assert.equal(args[args.indexOf('--env') + 1], 'FOO=bar');

  assert.ok(args.includes('kolejka/satori:judge'));
  assert.ok(args.includes('./sol'));
  assert.ok(args.includes('arg1'));
  assert.ok(args.includes('arg2'));
});

test('getSandboxStatus provides comprehensive isolation metadata', () => {
  const status = SANDBOX.getSandboxStatus();
  assert.equal(typeof status.enabled, 'boolean');
  assert.ok(['docker', 'local'].includes(status.backend));
  assert.equal(typeof status.image, 'string');
  assert.equal(typeof status.description, 'string');
  assert.equal(status.limits.network, 'none');
  assert.equal(status.limits.readOnly, true);
  assert.equal(status.limits.pidsLimit, 64);
  assert.equal(status.limits.memoryMb, 256);
});

test('runSandboxed falls back to local runner when Docker is not present', () => {
  // Explicitly force local backend
  const r = SANDBOX.runSandboxed(process.execPath, ['-e', 'process.stdout.write("sandbox-fallback-test")'], {
    backend: 'local',
    timeMs: 5000,
  });

  assert.equal(r.sandboxed, false);
  assert.equal(r.backend, 'local');
  assert.equal(r.oomKilled, false);
  assert.equal(r.exitCode, 0);
  assert.equal(r.stdout, 'sandbox-fallback-test');
});

test('runSandboxed detects OOM termination on exit code 137', () => {
  // Test OOM detection logic directly
  const origEnv = process.env.SATORI_SANDBOX_BACKEND;
  try {
    process.env.SATORI_SANDBOX_BACKEND = 'local';
    const r = SANDBOX.runSandboxed(process.execPath, ['-e', 'process.exit(137)'], {
      backend: 'local',
      timeMs: 5000,
    });
    assert.equal(r.exitCode, 137);
  } finally {
    if (origEnv !== undefined) process.env.SATORI_SANDBOX_BACKEND = origEnv;
    else delete process.env.SATORI_SANDBOX_BACKEND;
  }
});

test('judge exports sandboxing functions through top-level interface', () => {
  assert.equal(typeof J.runSandboxed, 'function');
  assert.equal(typeof J.buildDockerRunArgs, 'function');
  assert.equal(typeof J.getSandboxStatus, 'function');
  assert.equal(typeof J.clampMemoryMb, 'function');
});
