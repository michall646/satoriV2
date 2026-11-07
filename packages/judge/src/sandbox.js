// Satori V2 — containerized judge sandboxing (C15 / M7).
// Provides container isolation (Docker/OCI cgroups v2, no-network, read-only rootfs)
// with seamless fallback to hardened local process runner on dev environments.
'use strict';

const path = require('node:path');
const { runProcess, clampTimeMs } = require('./run');

const DEFAULT_IMAGE = process.env.SATORI_JUDGE_IMAGE || 'kolejka/satori:judge';
const DEFAULT_MEMORY_MB = 256;
const MIN_MEMORY_MB = 16;
const MAX_MEMORY_MB = 4096;
const DEFAULT_PIDS_LIMIT = 64;

let cachedDockerAvail = null;

function clampMemoryMb(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { memoryMb: DEFAULT_MEMORY_MB, clamped: false };
  if (n < MIN_MEMORY_MB) return { memoryMb: MIN_MEMORY_MB, clamped: true };
  if (n > MAX_MEMORY_MB) return { memoryMb: MAX_MEMORY_MB, clamped: true };
  return { memoryMb: Math.round(n), clamped: false };
}

function isDockerAvailable() {
  const explicit = process.env.SATORI_SANDBOX_BACKEND;
  if (explicit === 'local' || explicit === 'off' || explicit === '0') return false;
  if (explicit === 'docker' || explicit === 'container' || explicit === '1') return true;

  if (cachedDockerAvail !== null) return cachedDockerAvail;

  try {
    const r = runProcess('docker', ['--version'], { timeMs: 3000, maxOutputBytes: 16384 });
    cachedDockerAvail = !r.spawnError && !r.timedOut && r.exitCode === 0;
  } catch {
    cachedDockerAvail = false;
  }
  return cachedDockerAvail;
}

function resetCache() {
  cachedDockerAvail = null;
}

function buildDockerRunArgs(opts = {}) {
  const { memoryMb } = clampMemoryMb(opts.memoryMb);
  const pidsLimit = Math.max(8, Number(opts.pidsLimit) || DEFAULT_PIDS_LIMIT);
  const network = opts.network || 'none';
  const readOnly = opts.readOnly !== false;
  const image = opts.image || DEFAULT_IMAGE;
  const user = opts.user || '10001:10001';
  const containerCwd = opts.containerCwd || '/workspace';
  const tmpfsSize = opts.tmpfsSize || '64m';
  const cpus = opts.cpus || '1';

  const args = [
    'run',
    '--rm',
    '--network', network,
    '--memory', `${memoryMb}m`,
    '--memory-swap', `${memoryMb}m`,
    '--pids-limit', String(pidsLimit),
    '--cpus', String(cpus),
  ];

  if (readOnly) {
    args.push('--read-only');
  }

  args.push('--tmpfs', `/tmp:rw,noexec,nosuid,size=${tmpfsSize}`);

  if (opts.cwd) {
    const hostDir = path.resolve(opts.cwd);
    args.push('-v', `${hostDir}:${containerCwd}:rw`);
    args.push('-w', containerCwd);
  }

  if (user) {
    args.push('-u', user);
  }

  if (opts.env && typeof opts.env === 'object') {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v != null) args.push('--env', `${k}=${v}`);
    }
  }

  args.push(image);

  if (opts.cmd) {
    args.push(opts.cmd);
  }

  if (Array.isArray(opts.args)) {
    args.push(...opts.args);
  }

  return args;
}

function runSandboxed(cmd, args = [], opts = {}) {
  const useDocker = opts.backend === 'docker' || (opts.backend !== 'local' && isDockerAvailable());

  if (useDocker) {
    const dockerArgs = buildDockerRunArgs({
      cmd,
      args,
      cwd: opts.cwd,
      memoryMb: opts.memoryMb,
      pidsLimit: opts.pidsLimit,
      network: opts.network || 'none',
      readOnly: opts.readOnly !== false,
      image: opts.image || DEFAULT_IMAGE,
      env: opts.env,
    });

    const res = runProcess('docker', dockerArgs, {
      input: opts.input,
      timeMs: opts.timeMs,
      maxOutputBytes: opts.maxOutputBytes,
      cwd: opts.cwd,
    });

    // Exit code 137 indicates standard SIGKILL / OOM-killer termination in Docker
    const oomKilled = res.exitCode === 137 || /out of memory|oom-kill|killed/i.test(res.stderr || '');

    return {
      ...res,
      sandboxed: true,
      backend: 'docker',
      oomKilled,
      image: opts.image || DEFAULT_IMAGE,
    };
  }

  // Local fallback: execute directly via host runner
  const res = runProcess(cmd, args, opts);
  return {
    ...res,
    sandboxed: false,
    backend: 'local',
    oomKilled: false,
  };
}

function runBinary(binary, input, timeMs, opts = {}) {
  return runSandboxed(binary, [], {
    input,
    timeMs,
    cwd: path.dirname(binary),
    ...opts,
  });
}

function getSandboxStatus() {
  const dockerAvail = isDockerAvailable();
  return {
    enabled: dockerAvail,
    backend: dockerAvail ? 'docker' : 'local',
    image: DEFAULT_IMAGE,
    limits: {
      memoryMb: DEFAULT_MEMORY_MB,
      pidsLimit: DEFAULT_PIDS_LIMIT,
      network: 'none',
      readOnly: true,
      tmpfs: '/tmp:rw,noexec,nosuid,size=64m',
      cpus: 1,
    },
    description: dockerAvail
      ? `OCI container runner (${DEFAULT_IMAGE}, --network none, cgroups v2)`
      : 'interim local runner — memory limits not enforced yet (docs/JUDGE_SANDBOX.md)',
  };
}

module.exports = {
  isDockerAvailable,
  resetCache,
  clampMemoryMb,
  buildDockerRunArgs,
  runSandboxed,
  runBinary,
  getSandboxStatus,
  DEFAULT_IMAGE,
  DEFAULT_MEMORY_MB,
  MIN_MEMORY_MB,
  MAX_MEMORY_MB,
  DEFAULT_PIDS_LIMIT,
};
