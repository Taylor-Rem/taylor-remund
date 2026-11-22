// test-count: how many tests hold the bench, for the maker's plate on `/` (REWRITE.md § G "P4 as Taylor amended
// it": the plate "may show the bench's own workings live (… the tests …)"). The number is never typed by hand:
// this script takes it from a vitest run and writes src/content/bench-tests.json, which the page reads at build
// (src/components/paper/Panels.astro). The paperwork and the plate print it with the run's date.
//
// What counts: every test vitest collects from tests/unit and tests/scenario (vitest.config.ts), and only a run
// in which every one of them passed. A run with a failure, or with nothing in it, writes nothing and exits 1: a
// suite that does not pass does not hold the bench. Skipped tests are not counted.
//
//   VITEST_MAX_WORKERS=4 flock …/heavy.lock node scripts/test-count.ts     run the suite, then write the file
//   node scripts/test-count.ts --from <vitest.json>                        read a report vitest already wrote
//                                                                          (`vitest run --reporter=json --outputFile=…`)
//   node scripts/test-count.ts --check                                     print what the file says; write nothing
//
// The file is committed (it is content the page reads). Run this after the suite changes, before a build that
// will be shown; the plate says the date, so a number that is old says so itself.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isMain, REPO_ROOT } from './lib/cli.ts';

export const OUT_FILE = 'src/content/bench-tests.json';

/** What vitest's JSON reporter writes that this reads (the Jest-shaped summary). */
export interface VitestJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests?: number;
  numTodoTests?: number;
  success: boolean;
  startTime?: number;
}

export interface BenchTests {
  count: { text: string; kind: 'fact'; source: string };
  date: { text: string; kind: 'fact'; source: string };
  /** The raw figures, for a test or a person: never shown. */
  run: { passed: number; total: number; skipped: number; at: string; commit: string };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 21, 2026", in the visitor-facing form the site's dates use. */
export function longDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** The file's content from a run, or the reason there is none. */
export function fromRun(r: VitestJson, at: Date, commit: string): BenchTests | { refused: string } {
  const skipped = (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0);
  if (!r.success || r.numFailedTests > 0) return { refused: `the run did not pass (${r.numFailedTests} failed of ${r.numTotalTests})` };
  if (r.numPassedTests <= 0) return { refused: 'the run passed no tests' };
  const day = at.toISOString().slice(0, 10);
  const how = `scripts/test-count.ts from a vitest run of tests/unit and tests/scenario on ${day} at ${commit}: ${r.numPassedTests} passed, 0 failed${skipped ? `, ${skipped} skipped (not counted)` : ''}`;
  return {
    count: { text: r.numPassedTests.toLocaleString('en-US'), kind: 'fact', source: how },
    date: { text: longDate(at), kind: 'fact', source: how },
    run: { passed: r.numPassedTests, total: r.numTotalTests, skipped, at: at.toISOString(), commit },
  };
}

function commitOf(root: string): string {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  const head = r.status === 0 ? r.stdout.trim() : 'unknown';
  const dirty = spawnSync('git', ['-C', root, 'status', '--porcelain', '--', 'src', 'tests'], { encoding: 'utf8' });
  return dirty.status === 0 && dirty.stdout.trim() !== '' ? `${head} (with uncommitted changes)` : head;
}

function main(argv: string[]): number {
  let values: { from?: string; check?: boolean; help?: boolean };
  try {
    values = parseArgs({ args: argv, options: { from: { type: 'string' }, check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }, strict: true }).values;
  } catch (e) {
    console.error(`test-count: ${(e as Error).message}`);
    return 2;
  }
  if (values.help) {
    console.log('usage: node scripts/test-count.ts [--from <vitest.json>] [--check]\n\nWrites src/content/bench-tests.json from a vitest run in which every test passed (exit 1 otherwise).');
    return 0;
  }
  const out = join(REPO_ROOT, OUT_FILE);
  if (values.check) {
    if (!existsSync(out)) {
      console.log(`test-count: no ${OUT_FILE} yet`);
      return 1;
    }
    const f = JSON.parse(readFileSync(out, 'utf8')) as BenchTests;
    console.log(`test-count: ${f.count.text} tests passed on ${f.date.text} (${f.run.commit})`);
    return 0;
  }
  let report: VitestJson;
  let at = new Date();
  if (values.from) {
    report = JSON.parse(readFileSync(values.from, 'utf8')) as VitestJson;
    if (report.startTime) at = new Date(report.startTime);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'test-count-'));
    const file = join(dir, 'vitest.json');
    try {
      const r = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${file}`], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
      if (!existsSync(file)) {
        console.error(`test-count: vitest wrote no report (exit ${r.status})`);
        return 1;
      }
      report = JSON.parse(readFileSync(file, 'utf8')) as VitestJson;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const made = fromRun(report, at, commitOf(REPO_ROOT));
  if ('refused' in made) {
    console.error(`test-count: nothing written: ${made.refused}`);
    return 1;
  }
  writeFileSync(out, `${JSON.stringify(made, null, 2)}\n`);
  console.log(`test-count: ${made.count.text} tests passed on ${made.date.text}; wrote ${OUT_FILE}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
