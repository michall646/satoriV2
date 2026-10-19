# Judge sandbox — interim limits & known gaps

> Status 2026-10-19: **interim local runner** (S1-7). Full isolation ships with
> the Docker/cgroups worker (decision D3, task S4-12). This page is the honest
> contract for what is and is not enforced today.

## Enforced today (local runner)

All process execution goes through one choke point: `packages/judge/src/run.js`.

| Limit | Behaviour |
|-------|-----------|
| Per-test wall time | Per-case `timeMs`, else `problem.limits.perLang[lang]`, else `limits.timeMs`. `perLang` is an **absolute millisecond limit**, not a multiplier. The runner clamps to 100 ms – **120 s** (and falls back to 2 s only when no value is supplied); it reports `limitClamped` and the effective `timeLimitMs`. On timeout the child is killed (`killSignal: SIGKILL`) and the test is `TLE`. |
| Output cap | 1 MB per stream (`maxBuffer`). Exceeding it kills the child and the test is `RE` with `output limit exceeded (1 MB cap)`. |
| Environment | Scrubbed: only `PATH`, `SystemRoot`, `TEMP`, `TMP`, `HOME`, `LANG`, `LC_ALL`, `PATHEXT` are passed. No secrets/tokens from the API process leak into submissions. |
| Working directory | Fresh temp dir per submit (`satori-c-*`, `satori-cpp-*`, `satori-java-*`, `satori-py-*`, `satori-js-*`, `satori-rs-*`), removed after judging. |
| C vs C++ | C is compiled by `gcc` with `.c` and `-std=c17`; C++ by `g++` with `.cpp` and `-std=c++17`. C code is never compiled as C++. Availability is probed separately: `/api/status` can report `gcc` missing while `g++` works. |
| Compile time | 15 s (C/C++), 30 s (Java, Rust); output capped at 2 MB. |
| No toolchain | The submit is **simulated** and flagged `simulated: true` with an explicit explain string — a simulated verdict is never presented as a real run. |

## Not enforced yet (gap — never claim otherwise)

- **Memory**: no cgroup/RSS accounting. `memMb` is `null` on submits and absent
  on per-test entries — the judge does not fabricate numbers anymore. MLE is
  only produced by the `MLE-TRIGGER` test fixture.
- **CPU vs wall**: only wall clock is limited.
- **Process tree**: the direct child is killed on timeout; grandchildren can in
  theory survive (`spawnSync` semantics, no process groups). Docker `--pids-limit`
  fixes this in S4-12.
- **Filesystem**: submissions run as the API user and can read/write the host
  temp dir and their cwd. No chroot/overlay.
- **Network**: not blocked.
- **Syscalls / privileges**: no seccomp; submissions are ordinary processes of
  the API user, not a separate uid.

## Planned contract (D3 / S4-12)

- Container `kolejka/satori:judge` per language, `--network none`, read-only
  rootfs, tmpfs `/tmp`, cgroups v2 (`memory.max`, `cpu.max`, `pids.max`),
  non-root uid, seccomp profile.
- Memory measured from cgroup peak (then `memMb` returns as a real number).
- Kill by container stop (whole tree dies).
- `/api/status` currently reports the real local worker label (`local-spawn`) and
  language/toolchain availability. It does **not** advertise container images; image
  names return when the Docker worker is actually wired (S4-12).

## Serviced languages (D1)

C, C++17, Python, Java, Rust, JavaScript. SQL and CUDA are retired — submissions
are rejected with `LANG_OFF` (422) and are absent from `/api/languages`.
