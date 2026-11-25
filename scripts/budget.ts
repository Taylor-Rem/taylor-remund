// budget: the transfer budgets of REWRITE.md § E7 that can be measured
// statically, plus "no third-party request" on every page.
//
// "Transferred" is approximated: text assets (HTML, CSS, JS, SVG, JSON, wasm)
// count at their gzip level-9 size; images, fonts and audio count raw.

import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { formatBytes, isDir, isFile, toPosix, walk } from './lib/fsutil.ts';
import { attr, scripts } from './lib/html.ts';
import { htmlRefs } from './lib/refs.ts';
import type { HtmlRef } from './lib/refs.ts';
import { cssRefs } from './lib/css.ts';
import { classify, resolveToFile, urlPathForFile } from './lib/urls.ts';
import { findImports, tokenize } from './lib/jstok.ts';

/** Budgets, decimal units (1 KB = 1,000 bytes). */
export const BUDGETS = {
  firstPaint: 200_000,
  /** The "stage transfer" row: every script and wasm file in dist/_astro/ (a coarse ceiling, from before P3). */
  stage: 2_200_000,
  /** A stage page, to usable: everything it fetches up to the moment the bench takes input (the owner, 2026-11-25). */
  toUsable: 2_200_000,
  /** A stage page, to usable plus after: with what it goes on to fetch by itself (the late crew). The lead's number; the owner may move it. */
  afterTotal: 2_600_000,
  sound: 400_000,
  conventionalJs: 5_000,
};

const GZIP_EXT = /\.(html?|css|m?js|cjs|svg|json|xml|txt|wasm|map|webmanifest)$/i;
const JS_EXT = /\.(m?js|cjs|wasm)$/i;
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

export interface BudgetOptions {
  dist: string;
  /** Stage pages whose whole transfer is measured if the build has them (default: $BUDGET_STAGE_PAGES or STAGE_PAGES). */
  stagePages?: readonly string[];
}

export function transferSize(abs: string, cache: Map<string, number> = new Map()): number {
  const hit = cache.get(abs);
  if (hit !== undefined) return hit;
  const n = GZIP_EXT.test(abs) ? gzipSync(readFileSync(abs), { level: 9 }).length : statSync(abs).size;
  cache.set(abs, n);
  return n;
}

function rel(dist: string, abs: string): string {
  return toPosix(relative(dist, abs));
}

/** URL path of a file in dist, for resolving references made from it. */
function fileUrl(dist: string, abs: string): string {
  return urlPathForFile(rel(dist, abs));
}

/** Stylesheets reachable through @import, and their url() refs, from a CSS file. */
export function cssClosure(dist: string, cssAbs: string, seen: Set<string> = new Set()): { files: string[]; refs: { url: string; base: string; fontFallback: boolean; from: string }[] } {
  const files: string[] = [];
  const refs: { url: string; base: string; fontFallback: boolean; from: string }[] = [];
  const visit = (abs: string): void => {
    if (seen.has(abs)) return;
    seen.add(abs);
    files.push(abs);
    const base = fileUrl(dist, abs);
    for (const r of cssRefs(readFileSync(abs, 'utf8'))) {
      if (r.kind === 'import') {
        const c = classify(r.url, base);
        if (c.kind === 'internal') {
          const t = resolveToFile(dist, c.path);
          if (t) visit(t);
        } else if (c.kind === 'external') {
          refs.push({ url: r.url, base, fontFallback: false, from: rel(dist, abs) + ' @import' });
        }
      } else {
        refs.push({ url: r.url, base, fontFallback: r.fontFallback, from: rel(dist, abs) + ' url()' });
      }
    }
  };
  visit(cssAbs);
  return { files, refs };
}

/** JS files reachable by static and literal dynamic imports from `entry`; external specifiers listed apart. */
export function jsClosure(dist: string, entries: string[]): { files: string[]; external: string[] } {
  const seen = new Set<string>();
  const external: string[] = [];
  const stack = [...entries];
  while (stack.length) {
    const abs = stack.pop() as string;
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!/\.(m?js|cjs)$/i.test(abs)) continue;
    const base = fileUrl(dist, abs);
    for (const imp of findImports(tokenize(readFileSync(abs, 'utf8')))) {
      if (!imp.specifier) continue;
      const s = imp.specifier;
      if (!/^(\.|\/|https?:)/i.test(s)) continue; // bare: cannot exist in a browser bundle
      const c = classify(s, base);
      if (c.kind === 'external') external.push(`${rel(dist, abs)} imports ${c.url}`);
      else if (c.kind === 'internal') {
        const t = resolveToFile(dist, c.path);
        if (t) stack.push(t);
      }
    }
  }
  return { files: [...seen], external };
}

interface PageScan {
  html: string;
  refs: HtmlRef[];
  /** Third-party requests: description strings. */
  thirdParty: string[];
  /** JS bytes (raw) and the files counted. */
  jsBytes: number;
  jsFiles: string[];
}

export function scanPage(dist: string, abs: string): PageScan {
  const html = readFileSync(abs, 'utf8');
  const urlPath = fileUrl(dist, abs);
  const refs = htmlRefs(html);
  const thirdParty: string[] = [];
  const scriptEntries: string[] = [];
  for (const ref of refs) {
    if (!ref.resource) continue;
    const c = classify(ref.url, urlPath);
    if (c.kind === 'external') {
      thirdParty.push(`${ref.where} ${c.url}`);
      continue;
    }
    if (c.kind !== 'internal') continue;
    const t = resolveToFile(dist, c.path);
    if (!t) continue;
    if (ref.as === 'stylesheet') {
      for (const cr of cssClosure(dist, t).refs) {
        const cc = classify(cr.url, cr.base);
        if (cc.kind === 'external') thirdParty.push(`${cr.from} ${cc.url}`);
      }
    }
    if ((ref.as === 'script' || ref.as === 'modulepreload') && JS_EXT.test(t)) scriptEntries.push(t);
  }
  const closure = jsClosure(dist, scriptEntries);
  for (const e of closure.external) thirdParty.push(e);
  let jsBytes = 0;
  for (const s of scripts(html)) {
    const type = (attr(s.tag, 'type') ?? '').toLowerCase().trim();
    if (attr(s.tag, 'src') !== undefined || !JS_TYPES.has(type)) continue;
    jsBytes += Buffer.byteLength(s.body, 'utf8');
    for (const imp of findImports(tokenize(s.body))) {
      if (imp.specifier && /^https?:|^\/\//i.test(imp.specifier)) thirdParty.push(`inline script imports ${imp.specifier}`);
    }
  }
  for (const f of closure.files) jsBytes += statSync(f).size;
  return { html, refs, thirdParty, jsBytes, jsFiles: closure.files.map((f) => rel(dist, f)) };
}

/**
 * The stage pages whose static closure the "stage page" row measures when the
 * build contains them (a normal build has none of them, so its verify is
 * unchanged). `BUDGET_STAGE_PAGES=/dev/bench/,/` replaces the list. `/` (P3)
 * is in every build: its row is the stage tiers' transfer (high and low fetch the same files; the Still
 * tier fetches none of the scripts, the wasm, the bake table or the label fonts).
 */
export const STAGE_PAGES: readonly string[] = ['/', '/dev/bench/', '/dev/handoff/'];

/** Quoted strings in a script that name a file the stage fetches at run time (wasm, the bake table, fonts, worker scripts). */
const ASSET_STRING = /["'`]([^"'`\s]{1,200}\.(?:wasm|bin|woff2|m?js))["'`]/g;

/**
 * What a stage page fetches, read from the build, in two parts (the owner's ruling, 2026-11-25: the budget is for
 * what loads before the bench is usable, with a looser cap on what the page fetches by itself afterwards).
 *
 * Everything: the page, its stylesheets and their fonts, its scripts and every script they import (statically or
 * by a literal dynamic import), and every file a script names in a string (the physics wasm, the bake table, worker
 * scripts and what they import, the label fonts, which the labels load by file name under /fonts/; the build's
 * preload lists name the chunks a dynamic import needs). Each counted once, at what the wire carries
 * (`transferSize`: gzip -9 for text and wasm, raw for the bake table, which is compressed in itself, and for fonts).
 *
 * After (`after`): what is reached only through a late chunk, a chunk named `late-*` (astro.config's late groups:
 * a crew member who arrives after the bench is live, shell/late.ts). A dynamic import, or a file named in a string,
 * whose static imports reach a late chunk is a way into the "after" part; so is the late chunk named in a string.
 * Everything else is "to usable" (`items`): conservatively, every other dynamic import too (the sound's code, which
 * is fetched in idle time after the bench starts, is counted there as it always was).
 *
 * `eagerLate`: late chunks a page reaches by static imports alone (or names in a modulepreload): the build has
 * folded a late unit back into what the page loads first. The budget fails on any.
 */
export function stageClosure(dist: string, page: string, cache: Map<string, number> = new Map()): { total: number; items: [string, number][]; unresolved: string[]; after: [string, number][]; afterTotal: number; eagerLate: string[] } {
  const abs = resolveToFile(dist, page);
  if (!abs) return { total: 0, items: [], unresolved: [`${page}: not in the build`], after: [], afterTotal: 0, eagerLate: [] };
  const files = new Set<string>([abs]);
  const unresolved: string[] = [];
  const html = readFileSync(abs, 'utf8');
  const entries: string[] = [];
  const eagerLate = new Set<string>();
  for (const ref of htmlRefs(html)) {
    if (!ref.resource) continue;
    const c = classify(ref.url, page);
    if (c.kind !== 'internal') continue;
    const t = resolveToFile(dist, c.path);
    if (!t) continue;
    if (ref.as === 'stylesheet' && t.endsWith('.css')) {
      const cl = cssClosure(dist, t);
      for (const f of cl.files) files.add(f);
      for (const cr of cl.refs) {
        if (cr.fontFallback) continue;
        const cc = classify(cr.url, cr.base);
        const u = cc.kind === 'internal' ? resolveToFile(dist, cc.path) : null;
        if (u) files.add(u);
      }
    } else if ((ref.as === 'script' || ref.as === 'modulepreload') && JS_EXT.test(t)) entries.push(t);
  }
  // scripts inline in the page import modules too
  for (const s of scripts(html)) for (const imp of findImports(tokenize(s.body))) if (imp.specifier && /^\//.test(imp.specifier)) {
    const t = resolveToFile(dist, imp.specifier);
    if (t) entries.push(t);
  }
  const byName = new Map<string, string[]>();
  for (const f of walk(dist)) {
    const b = f.replace(/^.*\//, '');
    byName.set(b, [...(byName.get(b) ?? []), join(dist, f)]);
  }

  // each script's edges, read once: static imports, dynamic imports, and files named in strings
  type Edges = { stat: string[]; dyn: string[]; named: string[] };
  const edges = new Map<string, Edges>();
  const edgesOf = (f: string): Edges => {
    const hit = edges.get(f);
    if (hit) return hit;
    const e: Edges = { stat: [], dyn: [], named: [] };
    edges.set(f, e);
    if (!/\.(m?js|cjs)$/i.test(f)) return e;
    const src = readFileSync(f, 'utf8');
    const base = fileUrl(dist, f);
    for (const imp of findImports(tokenize(src))) {
      if (!imp.specifier || !/^(\.|\/)/.test(imp.specifier)) continue;
      const c = classify(imp.specifier, base);
      const t = c.kind === 'internal' ? resolveToFile(dist, c.path) : null;
      if (!t) continue;
      (imp.kind === 'dynamic' ? e.dyn : e.stat).push(t);
    }
    for (const m of src.matchAll(ASSET_STRING)) {
      const s = m[1]!;
      if (/^(https?:)?\/\//.test(s)) continue;
      let t: string | null = null;
      if (s.startsWith('/') || s.startsWith('.')) {
        const c = classify(s, base);
        t = c.kind === 'internal' ? resolveToFile(dist, c.path) : null;
      } else {
        // a bare file name (the labels' fonts), or a chunk in the build's preload lists (`_astro/x.js`)
        const hits = byName.get(s.replace(/^.*\//, '')) ?? [];
        if (hits.length === 1) t = hits[0]!;
      }
      if (!t) {
        if (!/\.m?js$/.test(s)) unresolved.push(`${rel(dist, f)} names ${s}`);
        continue;
      }
      e.named.push(t);
    }
    return e;
  };
  /** Its static imports reach a late chunk (or it is one): a way into the "after" part. */
  const lateMemo = new Map<string, boolean>();
  const reachesLate = (f: string): boolean => {
    const hit = lateMemo.get(f);
    if (hit !== undefined) return hit;
    const seen = new Set<string>();
    const stack = [f];
    let found = false;
    while (stack.length && !found) {
      const g = stack.pop()!;
      if (seen.has(g)) continue;
      seen.add(g);
      if (isLate(g)) found = true;
      else stack.push(...edgesOf(g).stat);
    }
    lateMemo.set(f, found);
    return found;
  };

  // the page's static closure: a late chunk in it is one the page cannot load without
  {
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length) {
      const g = stack.pop()!;
      if (seen.has(g)) continue;
      seen.add(g);
      if (isLate(g)) eagerLate.add(rel(dist, g));
      stack.push(...edgesOf(g).stat);
    }
  }
  // to usable: the entries, their static imports, and every way on that does not lead into a late chunk
  const usable = new Set<string>(files);
  const lateRoots = new Set<string>();
  const queue = [...entries];
  const done = new Set<string>();
  while (queue.length) {
    const f = queue.pop()!;
    if (done.has(f)) continue;
    done.add(f);
    usable.add(f);
    const e = edgesOf(f);
    for (const t of e.stat) queue.push(t);
    for (const t of [...e.dyn, ...e.named]) {
      if (/\.(m?js|cjs)$/i.test(t) && reachesLate(t) && !eagerLate.has(rel(dist, t))) lateRoots.add(t);
      else queue.push(t);
    }
  }
  // after: everything reached from those ways in that the page has not already fetched
  const later = new Set<string>();
  const q2 = [...lateRoots];
  while (q2.length) {
    const f = q2.pop()!;
    if (later.has(f) || usable.has(f)) continue;
    later.add(f);
    const e = edgesOf(f);
    q2.push(...e.stat, ...e.dyn, ...e.named);
  }
  const sized = (set: Set<string>): [string, number][] => [...set].map((f): [string, number] => [rel(dist, f), transferSize(f, cache)]).sort((a, b) => b[1] - a[1]);
  const items = sized(usable);
  const after = sized(later);
  return {
    total: items.reduce((s, [, n]) => s + n, 0),
    items,
    unresolved: [...new Set(unresolved)],
    after,
    afterTotal: after.reduce((s, [, n]) => s + n, 0),
    eagerLate: [...eagerLate],
  };
}

/** A late chunk: what a late unit's group is named in the build (astro.config: `late-*`). */
export function isLate(abs: string): boolean {
  return /^late-[^/]*\.m?js$/i.test(abs.replace(/^.*\//, ''));
}

const exact = (n: number): string => n.toLocaleString('en-US');

function row(r: Report, label: string, measured: number, budget: number, note = ''): void {
  const text = `${label}: ${formatBytes(measured)} of ${formatBytes(budget)}${note ? ` (${note})` : ''}`;
  if (measured <= budget) r.ok(text);
  else r.fail(text + ' — over budget');
}

export function firstPaintOfHome(dist: string, cache: Map<string, number>): { total: number; items: [string, number][]; notes: string[] } {
  const home = join(dist, 'index.html');
  const raw = readFileSync(home, 'utf8');
  // what waits in a <template> is not fetched with the page (the stage's preloads on `/`: put in the head only
  // once a stage tier is chosen, P3 B1; the stage page row below counts them)
  const html = raw.replace(/<template\b[\s\S]*?<\/template>/gi, '');
  const items: [string, number][] = [['index.html', transferSize(home, cache)]];
  const notes: string[] = [];
  if (html !== raw) notes.push('links inside <template> (fetched only when a stage tier is chosen) not counted');
  const counted = new Set<string>([home]);
  const groups = new Map<number, { file: string; source: boolean; alt: boolean }[]>();
  /** Per <picture>: the `media` of each <source> met, and the tag that first had it. */
  const mediaSeen = new Map<number, Map<string, unknown>>();
  const add = (abs: string): void => {
    if (counted.has(abs)) return;
    counted.add(abs);
    items.push([rel(dist, abs), transferSize(abs, cache)]);
  };
  const resolveRef = (url: string, base: string, where: string): string | null => {
    const c = classify(url, base);
    if (c.kind !== 'internal') return null; // third-party: reported by its own row
    const t = resolveToFile(dist, c.path);
    if (!t) notes.push(`${where} ${url} not found (check-links reports it)`);
    return t;
  };
  const refs = htmlRefs(html);
  // A `loading="lazy"` picture is fetched when it nears the screen, not with the first paint (the paperwork's
  // pictures on `/`, below the stage's picture): every candidate of it (a <picture>'s <source>s take the
  // <img>'s loading) is named in a note, not counted.
  const lazyGroups = new Set(refs.filter((r) => r.lazy && r.group !== undefined).map((r) => r.group));
  const lazy = new Set<string>();
  for (const ref of refs) {
    if (!ref.resource) continue;
    if (ref.lazy || (ref.group !== undefined && lazyGroups.has(ref.group))) {
      const t = resolveRef(ref.url, '/', ref.where);
      if (t) lazy.add(t);
      continue;
    }
    if (ref.as === 'script' || ref.as === 'modulepreload' || ref.as === 'hint' || ref.as === 'frame' || ref.as === 'media') continue;
    const t = resolveRef(ref.url, '/', ref.where);
    if (!t) continue;
    if (ref.group !== undefined) {
      const g = groups.get(ref.group) ?? [];
      const source = ref.where.startsWith('source');
      // a later <source> with the same media is another format of the same picture (the JPEG after the AVIF):
      // a browser takes the first whose type it supports, so it is a fallback, like the <img>'s own src
      let alt = false;
      if (source) {
        const seen = mediaSeen.get(ref.group) ?? new Map<string, unknown>();
        mediaSeen.set(ref.group, seen);
        const media = (ref.tag ? attr(ref.tag, 'media') : undefined) ?? '';
        const first = seen.get(media);
        if (first === undefined) seen.set(media, ref.tag);
        else alt = first !== ref.tag;
      }
      g.push({ file: t, source, alt });
      groups.set(ref.group, g);
      continue;
    }
    if (ref.as === 'stylesheet' && t.endsWith('.css')) {
      const cl = cssClosure(dist, t);
      for (const f of cl.files) add(f);
      for (const cr of cl.refs) {
        if (cr.fontFallback) continue;
        const u = resolveRef(cr.url, cr.base, cr.from);
        if (u) add(u);
      }
      continue;
    }
    if (ref.fontFallback) continue;
    add(t);
  }
  // An <img>/<picture> fetches one candidate: count the largest. In a <picture> whose <source>s cover every
  // case (the stage's picture: one AVIF per aspect band, P3 B1), the <img>'s own src is the fallback for a
  // browser that takes none of them (no AVIF: none current); the largest <source> candidate is what a
  // browser fetches, and the fallback is named in a note.
  for (const g of groups.values()) {
    const sources = g.filter((c) => c.source && !c.alt);
    const pool = sources.length ? sources : g;
    const best = pool.map((c) => c.file).reduce((a, b) => (transferSize(b, cache) > transferSize(a, cache) ? b : a));
    add(best);
    for (const c of new Set(g.filter((x) => (!x.source || x.alt) && sources.length && !counted.has(x.file)).map((x) => x.file))) notes.push(`${rel(dist, c)} (${formatBytes(transferSize(c, cache))}): a fallback format of a <picture> whose first <source>s every current browser takes; not counted`);
  }
  for (const f of lazy) if (!counted.has(f)) notes.push(`${rel(dist, f)} (${formatBytes(transferSize(f, cache))}): loading="lazy", fetched when it nears the screen; not counted`);
  const total = items.reduce((a, [, n]) => a + n, 0);
  return { total, items, notes };
}

export function checkBudget(opts: BudgetOptions): Report {
  const r = new Report('budget');
  const dist = opts.dist;
  if (!isDir(dist)) {
    r.fail(`build output not found: ${dist} (run the build first)`);
    return r;
  }
  r.info('       "transferred" ≈ gzip -9 size for HTML/CSS/JS/SVG/JSON/wasm, raw size for images, fonts and audio; 1 KB = 1,000 bytes');
  const cache = new Map<string, number>();
  const home = join(dist, 'index.html');

  // First paint of /
  if (!isFile(home)) {
    r.fail('first paint of /: dist/index.html missing');
  } else {
    const fp = firstPaintOfHome(dist, cache);
    for (const [f, n] of fp.items) r.info(`         ${formatBytes(n).padStart(9)}  ${f}`);
    for (const n of fp.notes) r.note(n);
    row(r, 'first paint of / (HTML, stylesheets, fonts, images without JavaScript; largest candidate per image; every @font-face first source)', fp.total, BUDGETS.firstPaint);
  }

  // Stage transfer
  {
    const files = new Set<string>();
    for (const f of walk(join(dist, '_astro'))) if (JS_EXT.test(f)) files.add(join(dist, '_astro', f));
    if (isFile(home)) {
      const scan = scanPage(dist, home);
      for (const f of scan.jsFiles) files.add(join(dist, f));
    }
    let total = 0;
    for (const f of files) total += transferSize(f, cache);
    row(r, `stage transfer (${files.size} script/wasm file${files.size === 1 ? '' : 's'}: dist/_astro/ plus what / references, gzip -9)`, total, BUDGETS.stage);
  }

  // A stage page's whole transfer, when the build has one (dev pages built with WORKSHOP_DEV_PAGES=1; `/` from P3)
  {
    const list = (opts.stagePages ?? (process.env['BUDGET_STAGE_PAGES'] ? process.env['BUDGET_STAGE_PAGES'].split(',').map((s) => s.trim()).filter(Boolean) : STAGE_PAGES));
    for (const page of list) {
      if (!resolveToFile(dist, page)) continue;
      const sc = stageClosure(dist, page, cache);
      // a page without a script is no stage page (yet): no row
      if (!sc.items.some(([f]) => JS_EXT.test(f))) continue;
      for (const [f, n] of sc.items.slice(0, 8)) r.info(`         ${formatBytes(n).padStart(9)}  ${f}`);
      r.info(`         ${formatBytes(sc.items.slice(8).reduce((s, [, n]) => s + n, 0)).padStart(9)}  ${sc.items.length - 8} more files`);
      for (const u of sc.unresolved) r.note(`${page}: ${u} (not found in the build: not counted)`);
      row(r, `stage page ${page}: to usable, everything it fetches up to the bench taking input (${sc.items.length} files: page, CSS, fonts, scripts, wasm, workers, bake table; at what the wire carries; ${exact(sc.total)} B)`, sc.total, BUDGETS.toUsable);
      for (const [f, n] of sc.after) r.info(`         ${formatBytes(n).padStart(9)}  ${f} (after)`);
      row(r, `stage page ${page}: to usable + after, with what it fetches by itself once the bench is live (${sc.after.length} late file${sc.after.length === 1 ? '' : 's'}, ${exact(sc.afterTotal)} B; ${exact(sc.total + sc.afterTotal)} B in all)`, sc.total + sc.afterTotal, BUDGETS.afterTotal);
      for (const f of sc.eagerLate) r.fail(`stage page ${page}: ${f} is a late chunk, but the page reaches it eagerly (a static import or a modulepreload): a late unit was folded back into what loads first`);
    }
  }

  // Sound
  {
    const dir = join(dist, 'sounds');
    if (!isDir(dir)) {
      r.ok('sound: no dist/sounds/ (0 B of 400.0 KB)');
    } else {
      const files = walk(dir);
      const total = files.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
      row(r, `sound (${files.length} file${files.length === 1 ? '' : 's'} under dist/sounds/, raw)`, total, BUDGETS.sound);
    }
  }

  // Every page: third-party requests; conventional pages: JS
  const pages = walk(dist).filter((f) => f.endsWith('.html'));
  if (pages.length === 0) r.fail('no HTML pages in the build');
  for (const p of pages) {
    const urlPath = urlPathForFile(p);
    const scan = scanPage(dist, join(dist, p));
    const third = [...new Set(scan.thirdParty)];
    for (const t of third) r.fail(`${urlPath}: third-party request: ${t}`);
    if (third.length === 0) r.ok(`${urlPath}: no third-party request`);
    if (p !== 'index.html') row(r, `${urlPath}: JavaScript (raw, inline + referenced + imported)`, scan.jsBytes, BUDGETS.conventionalJs);
  }
  return r;
}

runCli(import.meta.url, {
  name: 'budget',
  summary: 'The static rows of REWRITE.md § E7: first paint of / ≤ 200 KB, stage scripts ≤ 2.2 MB, a stage page to usable ≤ 2.2 MB and with what it fetches after ≤ 2.6 MB (no late chunk reached eagerly), sound ≤ 400 KB, conventional pages ≤ 5 KB JS, no third-party request anywhere.',
  usesDist: true,
}, (o) => checkBudget({ dist: o.dist }));
