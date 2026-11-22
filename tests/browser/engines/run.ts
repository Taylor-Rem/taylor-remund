/**
 * The engine set, as one command (REWRITE.md § E8 Browser row; gate G3 "the browser tests pass in three engines"):
 *
 *   PW_PORT=4449 node tests/browser/engines/run.ts                 build once, then each engine once
 *   PW_PORT=4449 node tests/browser/engines/run.ts --runs 5        five times each (one engine per run, in turn)
 *   … --engines firefox,webkit   --skip-build   --out <dir>
 *
 * The site is built once under the build lock; then every engine runs the tests tagged @engines against that
 * build (PW_SKIP_BUILD=1), each run behind its own hold of the browser lock (one browser on the machine at a
 * time, one engine per hold: P3-COMMON's rules). The locks are those of this machine, when they exist
 * (WORKSHOP_LOCKS, else /home/tweenson/taylorremund.com/shots/p2/lead); elsewhere it runs without them.
 *
 * Each run's whole output is kept in --out (default shots/engines/, which git ignores: not under test-results/,
 * which Playwright empties at the start of every run); the summary printed is each run's result line and its
 * time, and a table at the end. A run that did not end by itself (a timeout) leaves its
 * test server behind on the port: it is looked for and stopped by its process id before the next run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const runs = Number(opt('--runs') ?? 1);
const engines = (opt('--engines') ?? 'chromium,firefox,webkit').split(',').filter(Boolean);
const out = opt('--out') ?? join('shots', 'engines');
const port = process.env['PW_PORT'] ?? '4417';
const lockDir = process.env['WORKSHOP_LOCKS'] ?? '/home/tweenson/taylorremund.com/shots/p2/lead';
const locked = (lock: string, cmd: string[]): string[] => (existsSync(join(lockDir, lock)) ? ['flock', join(lockDir, lock), ...cmd] : cmd);
/** Per engine, the longest one run may take before it is stopped (a hung engine is a finding, not a wait). */
const LIMIT_S = Number(opt('--limit') ?? 900);

mkdirSync(out, { recursive: true });

if (!args.includes('--skip-build')) {
  const [cmd, ...rest] = locked('build.lock', ['npx', 'astro', 'build']);
  const r = spawnSync(cmd!, rest, { stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  if (r.status !== 0) {
    console.error('engines: the build failed');
    process.exit(1);
  }
}

/** Stop whatever still listens on the test server's port (an orphan of a run that was stopped). */
function freePort(): void {
  const ss = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
  for (const m of (ss.stdout ?? '').matchAll(/pid=(\d+)/g)) {
    console.log(`engines: an orphaned server on port ${port} (pid ${m[1]}): stopped`);
    try {
      process.kill(Number(m[1]), 'SIGTERM');
    } catch {
      /* gone already */
    }
  }
}

interface Result {
  engine: string;
  run: number;
  status: number | null;
  seconds: number;
  summary: string;
  failures: string[];
}
const results: Result[] = [];
for (let run = 1; run <= runs; run++) {
  for (const engine of engines) {
    freePort();
    const t0 = Date.now();
    const [cmd, ...rest] = locked('browser.lock', ['timeout', String(LIMIT_S), 'npx', 'playwright', 'test', '--workers=1', `--project=${engine}`, '--grep', '@engines', '--reporter=list']);
    const r = spawnSync(cmd!, rest, { encoding: 'utf8', env: { ...process.env, PW_SKIP_BUILD: '1', PW_PORT: port }, maxBuffer: 64 << 20 });
    const seconds = Math.round((Date.now() - t0) / 1000);
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `${engine}-${run}.txt`), text);
    const summary = text
      .split('\n')
      .filter((l) => /^\s+\d+ (passed|failed|flaky|skipped|did not run)/.test(l))
      .map((l) => l.trim())
      .join(', ');
    const failures = text.split('\n').filter((l) => /^\s+✘/.test(l)).map((l) => l.trim().slice(0, 240));
    results.push({ engine, run, status: r.status, seconds, summary: summary || `exit ${r.status} (no summary: see ${engine}-${run}.txt)`, failures });
    console.log(`engines: ${engine} run ${run}: ${results.at(-1)!.summary} in ${seconds} s (waiting for the lock included)`);
    for (const f of failures) console.log(`  ${f}`);
    if (r.status === 124) freePort();
  }
}

console.log('\nengine     run  time   result');
for (const r of results) console.log(`${r.engine.padEnd(10)} ${String(r.run).padStart(3)}  ${String(r.seconds).padStart(4)} s  ${r.summary}`);
process.exit(results.every((r) => r.status === 0) ? 0 : 1);
