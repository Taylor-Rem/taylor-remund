// check-pictures: the committed loading pictures are current (REWRITE.md § E6: "The still picture is rendered
// from the real scene by a script and committed; a check fails if the scene has changed since it was
// rendered"). No browser and no graphics card: it compares the hashes the recorders wrote with the hashes of
// the inputs now, through the recorders' own code (scripts/poster.ts `inputsHash`, scripts/bake.ts).
//
//   - every poster set (a posters.json under src/) against its page: stale, missing files or a band never
//     rendered is a FAIL that names the exact command that re-renders that set;
//   - the bake table (src/workshop/view/kit/bake-table.*): code or inputs changed is a FAIL naming
//     `node scripts/bake.ts`.
//
// A posters.json this check does not know is a FAIL too: add it to SETS in scripts/poster.ts.
// Re-rendering needs the real GPU and is the lead's (the pictures are committed); this only says they are due.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { inputsHash as posterHash, pageSource, SETS as POSTER_SETS } from './poster.ts';
import { codeHash, inputsHash as bakeInputs, readInfo, TABLE_BIN, TABLE_JSON } from './bake.ts';
import type { PosterSet } from '../src/workshop/shell/poster.ts';

/** Every poster set and the page it is rendered from: scripts/poster.ts's own list (SETS there). */
export const SETS: readonly { set: string; page: string }[] = POSTER_SETS;

function findSets(dir: string, root: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) findSets(p, root, out);
    else if (e.name === 'posters.json') out.push(relative(root, p));
  }
}

export function renderCommand(s: { set: string; page: string }): string {
  return `node scripts/poster.ts --set ${s.set} --page ${s.page}`;
}

export function checkPictures(root: string): Report {
  const report = new Report('check-pictures');
  const found: string[] = [];
  findSets(join(root, 'src'), root, found);
  for (const f of found.sort()) {
    if (!SETS.some((s) => s.set === f)) report.fail(`${f}: a picture set this check does not know; add it to SETS in scripts/poster.ts with the page it is rendered from`);
  }
  for (const s of SETS) {
    const path = join(root, s.set);
    if (!existsSync(path)) {
      report.fail(`${s.set}: missing (SETS names it; remove it there if the page went away)`);
      continue;
    }
    const set = JSON.parse(readFileSync(path, 'utf8')) as PosterSet;
    const now = posterHash(root, set, pageSource(s.page));
    const missing = set.posters.flatMap((p) => p.files).filter((f) => !existsSync(join(dirname(path), f.file)));
    const unrendered = set.posters.filter((p) => !p.view || p.files.length === 0).length;
    const why: string[] = [];
    if (set.hash !== now) why.push(`rendered from ${set.hash || 'nothing'}, the scene is now ${now}`);
    if (missing.length) why.push(`missing ${missing.map((f) => f.file).join(', ')}`);
    if (unrendered) why.push(`${unrendered} band(s) never rendered`);
    if (why.length) report.fail(`${s.set}: STALE: ${why.join('; ')}. Re-render (real GPU): ${renderCommand(s)}`);
    else report.ok(`${s.set}: ${set.posters.length} band(s), current (${now})`);
  }
  const info = readInfo(root);
  if (!info) report.fail(`${TABLE_JSON}: missing. Record (real GPU): node scripts/bake.ts`);
  else {
    const code = codeHash(root);
    const inputs = bakeInputs(root);
    const why: string[] = [];
    if (info.codeHash !== code) why.push(`the bake's code changed (${info.codeHash} → ${code}): the page ignores the table`);
    if (info.inputsHash !== inputs) why.push(`what shapes the pieces changed (${info.inputsHash} → ${inputs}): changed pieces bake live`);
    if (why.length) report.fail(`${TABLE_BIN}: STALE: ${why.join('; ')}. Record again (real GPU): node scripts/bake.ts`);
    else report.ok(`${TABLE_BIN}: ${info.entries} pieces, current (code ${code}, inputs ${inputs})`);
  }
  return report;
}

runCli(import.meta.url, { name: 'check-pictures', summary: 'The committed loading pictures (poster sets, the bake table) were made from the scene as it is now.', usesDist: false }, (o) => checkPictures(o.root));
