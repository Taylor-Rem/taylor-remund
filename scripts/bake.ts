// bake: record the cavity bake of every piece the stage pages build, in a
// real browser, into the table the runtime looks up instead of ray-tracing
// (K1; src/workshop/view/kit/bake.ts says how the lookup stays exact).
//
//   node scripts/bake.ts            build (with the dev pages), open each page with the recorder on,
//                                   play it a little, write the table
//        [--dist <dir>]             record from an existing build (built with WORKSHOP_DEV_PAGES=1)
//   node scripts/bake.ts --check    exit 1 if the table is out of date (see below), 0 if current
//
// Writes src/workshop/view/kit/bake-table.bin (the values) and
// bake-table.json (what made them: the hash of the bake's code, the hash of
// everything that shapes the pieces, counts). The pieces' geometry is made in
// the browser (label sizes come from the browser's own text measuring), so
// the table is recorded there, never in Node.
//
// Out of date means one of two things, and --check (and the unit test
// tests/unit/kit/bake.test.ts, for the first) says which:
//   - the bake's CODE changed: values in the table were made by other code.
//     A build hands the page the code's hash (integrations/bake-table.ts) and
//     the page then ignores the table; the unit test fails verify as well.
//   - what SHAPES the pieces changed (the view, the simulation, the content,
//     the fonts): the bake values are still right (keyed by content), but
//     changed pieces miss and bake live, and the recorded measurements (keyed
//     by name) are ignored by the page, so start-up is slower until re-recorded.
// Either way nothing is applied wrongly; --check and the build's warning say
// that the speed is gone.
//
// Exit codes: 0 ok, 1 failed or stale, 2 usage.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isMain, REPO_ROOT } from './lib/cli.ts';
import { PAPER_ONLY_CONTENT } from './lib/paper-content.ts';

export const TABLE_BIN = 'src/workshop/view/kit/bake-table.bin';
export const TABLE_JSON = 'src/workshop/view/kit/bake-table.json';

/** The bake's code: what turns an input into values. A change here makes old values wrong. */
export const CODE_FILES = ['src/workshop/view/kit/surface.ts', 'src/workshop/view/kit/bvh.ts', 'src/workshop/view/kit/rng.ts', 'src/workshop/view/kit/bake.ts', 'src/workshop/view/kit/bake-format.ts'];
/** What shapes the pieces the pages build (a change here only costs misses). */
export const INPUT_TREES = ['src/workshop/view', 'src/workshop/sim', 'src/content', 'public/fonts', 'src/dev-pages/vignette.astro', 'src/dev-pages/bench.astro', 'src/dev-pages/handoff.astro', 'src/workshop/shell/bench-stage.ts'];

export interface TableInfo {
  format: number;
  codeHash: string;
  inputsHash: string;
  entries: number;
  vertices: number;
  changed: number;
  measurements: number;
  bytes: number;
  pages: string[];
}

function walk(p: string, out: string[]): void {
  if (!existsSync(p)) return;
  const st = readdirSync(p, { withFileTypes: true });
  for (const e of st) {
    const q = join(p, e.name);
    if (e.isDirectory()) walk(q, out);
    else out.push(q);
  }
}

function hashFiles(root: string, files: string[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort()) {
    h.update(relative(root, f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 24);
}

export function codeHash(root = REPO_ROOT): string {
  return hashFiles(root, CODE_FILES.map((f) => join(root, f)));
}

export function inputsHash(root = REPO_ROOT): string {
  const files: string[] = [];
  for (const t of INPUT_TREES) {
    const p = join(root, t);
    if (existsSync(p) && statSync(p).isFile()) files.push(p);
    else walk(p, files);
  }
  // (the table itself; and the content only the paper pages read, which shapes no piece)
  const skip = new Set([TABLE_BIN, TABLE_JSON, ...PAPER_ONLY_CONTENT].map((f) => join(root, f)));
  return hashFiles(root, files.filter((f) => !skip.has(f)));
}

export function readInfo(root = REPO_ROOT): TableInfo | null {
  const p = join(root, TABLE_JSON);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as TableInfo) : null;
}

// ───────────────────────── recording ─────────────────────────

interface Run {
  path: string;
  w: number;
  h: number;
  dpr: number;
  /** Runs in the page once it is ready (the pieces that appear while playing). */
  play: string;
}

const VIGNETTE_PLAY = `(async () => {
  const v = window.__vignette;
  try {
    v.goto(500, 'home');
    v.goto(650, 'fetch');
    v.ws.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 480; i++) v.ws.advance(1);
  } catch (e) {
    console.warn('bake: the play stopped early:', e);
  }
})()`;
// the pieces that appear while playing are a bonus (a miss bakes live), so a rule of the world that
// refuses a step of this script ends the play, not the recording
const BENCH_PLAY = `(async () => {
  const b = window.__bench;
  try {
    b.goto(500, 'home');
    b.ws.dispatch({ type: 'press', id: 'button' });
    for (let i = 0; i < 480; i++) b.ws.advance(1);
  } catch (e) {
    console.warn('bake: the play stopped early:', e);
  }
})()`;

export const RUNS: readonly Run[] = [
  { path: '/dev/vignette/?hud=0&manual=1', w: 1440, h: 900, dpr: 1, play: VIGNETTE_PLAY },
  { path: '/dev/vignette/?hud=0&manual=1&tier=low', w: 1440, h: 900, dpr: 1, play: VIGNETTE_PLAY },
  { path: '/dev/vignette/?hud=0&manual=1', w: 390, h: 844, dpr: 2, play: VIGNETTE_PLAY },
  { path: '/dev/handoff/', w: 1440, h: 900, dpr: 1, play: '0' },
  { path: '/dev/bench/?hud=0&manual=1', w: 1440, h: 900, dpr: 1, play: BENCH_PLAY },
  { path: '/dev/bench/?hud=0&manual=1&tier=low', w: 1440, h: 900, dpr: 1, play: BENCH_PLAY },
  { path: '/dev/bench/?hud=0&manual=1', w: 390, h: 844, dpr: 2, play: BENCH_PLAY },
  // the home page builds the bench's pieces through the same glue (shell/bench-stage.ts); its stage tiers,
  // as a visitor's machine gets them (it has no hooks to play with: the start is what it records)
  { path: '/?tier=high', w: 1440, h: 900, dpr: 1, play: '0' },
  { path: '/?tier=low', w: 1440, h: 900, dpr: 1, play: '0' },
];

const READY = `(() => { const h = window.__handoff; return (h && typeof h.usableAt === 'number') || (!h && !!(window.__vignette || window.__bench) && window.__ready === true); })()`;

async function record(origin: string): Promise<{ entries: Map<string, Uint8Array>; measured: Record<string, unknown>; pages: string[]; conflicts: number; perRun: string[] }> {
  const { chromium } = await import('@playwright/test');
  const { GPU_ARGS } = await import('./capture.ts');
  const entries = new Map<string, Uint8Array>();
  const measured: Record<string, unknown> = {};
  const perRun: string[] = [];
  let conflicts = 0;
  for (const r of RUNS) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...GPU_ARGS, '--ignore-certificate-errors'] });
    try {
      const context = await browser.newContext({ viewport: { width: r.w, height: r.h }, deviceScaleFactor: r.dpr, ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript('globalThis.__bakeRecord = true;');
      await page.goto(origin + r.path, { waitUntil: 'commit', timeout: 60_000 });
      await page.waitForFunction(READY, null, { timeout: 180_000, polling: 100 });
      await page.evaluate(r.play);
      if (errors.length) throw new Error(`${r.path}: page error: ${errors[0]}`);
      const got = (await page.evaluate('globalThis.__bakeRecorded ?? []')) as Array<{ key: string; values: number[] }>;
      let fresh = 0;
      for (const e of got) {
        const v = Uint8Array.from(e.values);
        const had = entries.get(e.key);
        if (had) {
          // the same input baked twice (two pages, two runs): the values must be the same
          if (had.length !== v.length || had.some((x, i) => x !== v[i])) conflicts++;
          continue;
        }
        entries.set(e.key, v);
        fresh++;
      }
      const meas = (await page.evaluate('globalThis.__bakeMeasured ?? {}')) as Record<string, unknown>;
      for (const [k, m] of Object.entries(meas)) {
        // a measurement made twice must come out the same
        if (k in measured && JSON.stringify(measured[k]) !== JSON.stringify(m)) conflicts++;
        measured[k] = m;
      }
      perRun.push(`${r.path} ${r.w}x${r.h}@${r.dpr}: ${got.length} bakes, ${fresh} new; ${Object.keys(meas).length} measurements`);
      console.log(`bake: ${perRun.at(-1)}`);
    } finally {
      await browser.close();
    }
  }
  return { entries, measured, pages: RUNS.map((r) => `${r.path} ${r.w}x${r.h}@${r.dpr}`), conflicts, perRun };
}

// ───────────────────────── the command line ─────────────────────────

async function main(): Promise<number> {
  let v: Record<string, string | boolean | undefined>;
  try {
    v = parseArgs({ args: process.argv.slice(2), options: { dist: { type: 'string' }, check: { type: 'boolean' }, help: { type: 'boolean' } } }).values;
  } catch (e) {
    console.error(`bake: ${(e as Error).message}`);
    return 2;
  }
  if (v['help']) {
    console.log('usage: node scripts/bake.ts [--dist <dir>] | --check');
    return 0;
  }
  if (v['check']) {
    const info = readInfo();
    if (!info) {
      console.error(`bake: STALE: no ${TABLE_JSON}. Record: node scripts/bake.ts`);
      return 1;
    }
    const code = codeHash(), inputs = inputsHash();
    const bad: string[] = [];
    if (info.codeHash !== code) bad.push(`the bake's code changed (${info.codeHash} → ${code}): its values are no longer the code's`);
    if (info.inputsHash !== inputs) bad.push(`what shapes the pieces changed (${info.inputsHash} → ${inputs}): changed pieces will bake live`);
    if (bad.length) {
      console.error(`bake: STALE ${TABLE_BIN}: ${bad.join('; ')}. Record again: node scripts/bake.ts`);
      return 1;
    }
    console.log(`bake: ok, ${info.entries} pieces, ${info.vertices} vertices, ${(info.bytes / 1024).toFixed(0)} KB, code ${code}, inputs ${inputs}`);
    return 0;
  }

  const { buildWithDevPages, serveDist, tempBuildDir } = await import('./loadtime.ts');
  const { writeBakeTable, wrapBakeFile, BAKE_FORMAT, UNCHANGED } = await import('../src/workshop/view/kit/bake-format.ts');
  const { deflateSync } = await import('node:zlib');
  const code = codeHash(), inputs = inputsHash();
  let built: string | null = null;
  let dist = v['dist'] ? resolve(String(v['dist'])) : null;
  if (!dist) {
    built = tempBuildDir('bake');
    console.log('bake: building with the dev pages…');
    buildWithDevPages(built);
    dist = built;
  }
  const server = await serveDist(dist);
  try {
    const { entries, measured, pages, conflicts } = await record(server.origin);
    if (conflicts) {
      console.error(`bake: FAILED: ${conflicts} input(s) baked (or measured) to different values in different runs: not deterministic`);
      return 1;
    }
    if (inputsHash() !== inputs || codeHash() !== code) {
      console.error('bake: FAILED: the sources changed while recording; run it again');
      return 1;
    }
    const list = [...entries].map(([key, values]) => ({ key, values }));
    const body = writeBakeTable(list, { code, inputs, measured });
    const bin = wrapBakeFile(deflateSync(body, { level: 9 }), body.length);
    writeFileSync(join(REPO_ROOT, TABLE_BIN), bin);
    const vertices = list.reduce((s, e) => s + e.values.length, 0);
    const changed = list.reduce((s, e) => s + e.values.reduce((c, x) => c + (x !== UNCHANGED ? 1 : 0), 0), 0);
    const n = Object.keys(measured).length;
    const info: TableInfo = { format: BAKE_FORMAT, codeHash: code, inputsHash: inputs, entries: list.length, vertices, changed, measurements: n, bytes: bin.length, pages };
    writeFileSync(join(REPO_ROOT, TABLE_JSON), `${JSON.stringify(info, null, 2)}\n`);
    console.log(`bake: wrote ${TABLE_BIN}: ${list.length} pieces, ${vertices} vertices (${changed} changed by the bake), ${n} measurements, ${(bin.length / 1024).toFixed(0)} KB; code ${code}, inputs ${inputs}`);
    return 0;
  } finally {
    await server.stop();
    if (built) rmSync(built, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`bake: ${String(e instanceof Error ? e.stack : e)}`);
      process.exit(1);
    },
  );
}
