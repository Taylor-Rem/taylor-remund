// check-claims: every fact has a source (REWRITE.md § 3, § E4 invariant 6,
// § E8 "Claims", § F3).
//
// Walks every *.json under src/content/.
// - An entry is any object with a string `text`. It needs `kind` of "fact",
//   "voice" or "ui"; a "fact" needs a non-empty string `source`.
// - A toy truth-table row is any object with string `toy` and `real`. It
//   needs a non-empty string `source`.

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { isDir, walk } from './lib/fsutil.ts';

export const CONTENT_DIR = 'src/content';
export const KINDS: readonly string[] = ['fact', 'voice', 'ui'];

export interface ClaimProblem {
  file: string;
  path: string;
  problem: string;
}

const hasSource = (o: Record<string, unknown>): boolean => typeof o.source === 'string' && o.source.trim() !== '';

function key(path: string, k: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
}

/** Problems in one parsed JSON document, and how many entries and toy rows it holds. */
export function claimProblems(file: string, doc: unknown): { problems: ClaimProblem[]; entries: number; toyRows: number } {
  const problems: ClaimProblem[] = [];
  let entries = 0;
  let toyRows = 0;
  const visit = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}[${i}]`));
      return;
    }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') {
      entries++;
      if (!('kind' in o)) problems.push({ file, path, problem: 'entry has "text" but no "kind" (fact, voice or ui)' });
      else if (typeof o.kind !== 'string' || !KINDS.includes(o.kind)) problems.push({ file, path, problem: `entry "kind" is ${JSON.stringify(o.kind)}; must be "fact", "voice" or "ui"` });
      else if (o.kind === 'fact' && !hasSource(o)) problems.push({ file, path, problem: 'fact has no "source" (a fact that is not sourced does not appear)' });
    }
    if (typeof o.toy === 'string' && typeof o.real === 'string') {
      toyRows++;
      if (!hasSource(o)) problems.push({ file, path, problem: 'toy truth-table row has no "source" (a row with no source does not ship, § F3)' });
    }
    for (const [k, x] of Object.entries(o)) visit(x, key(path, k));
  };
  visit(doc, '$');
  return { problems, entries, toyRows };
}

export interface ClaimsOptions {
  root: string;
}

export function checkClaims(opts: ClaimsOptions): Report {
  const r = new Report('check-claims');
  const dir = join(opts.root, CONTENT_DIR);
  if (!isDir(dir)) {
    r.note(`${CONTENT_DIR}/ does not exist yet`);
    r.info('       0 entries');
    return r;
  }
  const files = walk(dir).filter((f) => f.endsWith('.json'));
  let entries = 0;
  let toyRows = 0;
  let problems = 0;
  for (const f of files) {
    const rel = posix.join(CONTENT_DIR, f);
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch (err) {
      r.fail(`${rel}: $: not valid JSON (${(err as Error).message})`);
      problems++;
      continue;
    }
    const res = claimProblems(rel, doc);
    entries += res.entries;
    toyRows += res.toyRows;
    for (const p of res.problems) {
      problems++;
      r.fail(`${p.file}: ${p.path}: ${p.problem}`);
    }
  }
  r.info(`       ${entries} entr${entries === 1 ? 'y' : 'ies'} and ${toyRows} toy row${toyRows === 1 ? '' : 's'} in ${files.length} JSON file${files.length === 1 ? '' : 's'} under ${CONTENT_DIR}/`);
  if (problems === 0) r.ok('every entry has a kind; every fact and toy row has a source');
  return r;
}

runCli(import.meta.url, {
  name: 'check-claims',
  summary: 'Every content entry (an object with "text") has a kind; every fact and every toy truth-table row has a source.',
  usesDist: false,
}, (o) => checkClaims({ root: o.root }));
