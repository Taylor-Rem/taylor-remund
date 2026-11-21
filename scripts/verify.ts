/**
 * `npm run verify` (REWRITE.md § E8): everything that needs no graphics card,
 * in order. Run with plain `node scripts/verify.ts` (Node 22 strips types).
 *
 *   --keep-going     run every selected step even after a failure
 *   --only a,b       run only these steps (still in the canonical order)
 *   --skip a,b       run every step except these
 *
 * A check script that does not exist is a FAIL, not a skip.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Step {
  name: string;
  /** The command, argv style; the first element is the program. */
  command: string[];
  /** A file that must exist for the step to run (the check scripts). */
  requires?: string;
}

export const CHECKS = [
  'check-urls',
  'check-legal',
  'check-links',
  'budget',
  'check-layers',
  'check-look',
  'check-claims',
  'check-prose',
  'check-pictures',
] as const;

export const STEPS: readonly Step[] = [
  { name: 'typecheck', command: ['npm', 'run', '--silent', 'typecheck'] },
  { name: 'unit', command: ['npx', 'vitest', 'run'] },
  { name: 'build', command: ['npx', 'astro', 'build'] },
  ...CHECKS.map((name) => ({
    name,
    command: ['node', `scripts/${name}.ts`, '--dist', 'dist'],
    requires: `scripts/${name}.ts`,
  })),
];

export interface Options {
  keepGoing: boolean;
  only: string[] | null;
  skip: string[];
}

export class UsageError extends Error {}

function list(value: string | undefined, flag: string): string[] {
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a comma-separated list of steps`);
  return value.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { keepGoing: false, only: null, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flag === '--keep-going') options.keepGoing = true;
    else if (flag === '--only') options.only = [...(options.only ?? []), ...list(inline ?? argv[++i], flag)];
    else if (flag === '--skip') options.skip.push(...list(inline ?? argv[++i], flag));
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  return options;
}

/** The steps to run, in canonical order. Unknown names are an error, not a silent no-op. */
export function selectSteps(steps: readonly Step[], options: Pick<Options, 'only' | 'skip'>): Step[] {
  const known = new Set(steps.map((s) => s.name));
  const unknown = [...(options.only ?? []), ...options.skip].filter((n) => !known.has(n));
  if (unknown.length > 0) {
    throw new UsageError(`unknown step(s): ${unknown.join(', ')}. Steps: ${[...known].join(', ')}`);
  }
  const only = options.only === null ? null : new Set(options.only);
  const skip = new Set(options.skip);
  return steps.filter((s) => (only === null || only.has(s.name)) && !skip.has(s.name));
}

export interface Result {
  name: string;
  ok: boolean;
  ms: number;
  note?: string;
}

export function runStep(step: Step, cwd: string): Result {
  const start = performance.now();
  if (step.requires !== undefined && !existsSync(join(cwd, step.requires))) {
    return { name: step.name, ok: false, ms: 0, note: `missing ${step.requires}` };
  }
  const [program, ...args] = step.command;
  const child = spawnSync(program!, args, { cwd, stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  const ms = performance.now() - start;
  if (child.error) return { name: step.name, ok: false, ms, note: child.error.message };
  return { name: step.name, ok: child.status === 0, ms, ...(child.status === 0 ? {} : { note: `exit ${child.status ?? child.signal}` }) };
}

export function formatResult(r: Result): string {
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  return `${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(13)} ${secs.padStart(7)}${r.note ? `  (${r.note})` : ''}`;
}

function main(): number {
  let options: Options;
  let steps: Step[];
  try {
    options = parseArgs(process.argv.slice(2));
    steps = selectSteps(STEPS, options);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`verify: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const cwd = process.cwd();
  const results: Result[] = [];
  for (const step of steps) {
    console.log(`\n── verify: ${step.name}`);
    const result = runStep(step, cwd);
    results.push(result);
    console.log(formatResult(result));
    if (!result.ok && !options.keepGoing) break;
  }
  const notRun = steps.slice(results.length).map((s) => s.name);
  console.log('\n── verify summary');
  for (const r of results) console.log(formatResult(r));
  if (notRun.length > 0) console.log(`not run (stopped at first failure): ${notRun.join(', ')}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? `verify: all ${results.length} step(s) passed` : `verify: ${failed} step(s) failed`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main();
