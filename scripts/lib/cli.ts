// Shared command-line handling: --dist / --root / --help, the main() guard,
// and exit codes (0 pass, 1 fail, 2 usage error).

import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Report } from './report.ts';

/** The repository root: the folder that holds scripts/. */
export const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface CliOptions {
  dist: string;
  root: string;
}

export interface CliSpec {
  name: string;
  summary: string;
  /** Whether the script reads a built output directory. */
  usesDist: boolean;
}

export function usage(spec: CliSpec): string {
  const lines = [
    `usage: node scripts/${spec.name}.ts [options]`,
    '',
    spec.summary,
    '',
    'options:',
  ];
  lines.push(
    spec.usesDist
      ? '  --dist <dir>   built output to inspect (default: <root>/dist)'
      : '  --dist <dir>   accepted and ignored (this check reads sources, not the build)',
  );
  lines.push('  --root <dir>   repository root (default: the folder holding scripts/)');
  lines.push('  --help         print this and exit');
  lines.push('', 'exit codes: 0 pass, 1 fail, 2 usage error');
  return lines.join('\n');
}

/** Parses argv; returns options, or a number (exit code) when it already printed. */
export function parseCli(argv: string[], spec: CliSpec): CliOptions | number {
  let values: { dist?: string; root?: string; help?: boolean };
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        dist: { type: 'string' },
        root: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    });
    values = parsed.values as typeof values;
  } catch (err) {
    console.error(`${spec.name}: ${(err as Error).message}`);
    console.error(usage(spec));
    return 2;
  }
  if (values.help) {
    console.log(usage(spec));
    return 0;
  }
  // --dist is accepted (and ignored) by the source checks so one runner can
  // pass the same arguments to every script.
  const root = resolve(values.root ?? REPO_ROOT);
  const dist = resolve(values.dist ?? resolve(root, 'dist'));
  return { dist, root };
}

/** True when the module at `url` is the script node was asked to run. */
export function isMain(url: string): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

/** Runs a check from the command line and exits with its code. */
export function runCli(url: string, spec: CliSpec, run: (opts: CliOptions) => Report): void {
  if (!isMain(url)) return;
  const opts = parseCli(process.argv.slice(2), spec);
  if (typeof opts === 'number') process.exit(opts);
  let report: Report;
  try {
    report = run(opts);
  } catch (err) {
    console.error(`${spec.name}: internal error: ${(err as Error).stack ?? err}`);
    process.exit(1);
  }
  report.print();
  process.exit(report.exitCode);
}
