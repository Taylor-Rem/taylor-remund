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
import { LEGACY_PASSTHROUGH } from './site.ts';

/** Budgets, decimal units (1 KB = 1,000 bytes). */
export const BUDGETS = {
  firstPaint: 200_000,
  stage: 2_200_000,
  sound: 400_000,
  conventionalJs: 5_000,
};

const GZIP_EXT = /\.(html?|css|m?js|cjs|svg|json|xml|txt|wasm|map|webmanifest)$/i;
const JS_EXT = /\.(m?js|cjs|wasm)$/i;
const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript']);

export interface BudgetOptions {
  dist: string;
  /** Pages exempt from the third-party and JS rows (default: LEGACY_PASSTHROUGH). */
  exempt?: readonly string[];
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

function row(r: Report, label: string, measured: number, budget: number, note = ''): void {
  const text = `${label}: ${formatBytes(measured)} of ${formatBytes(budget)}${note ? ` (${note})` : ''}`;
  if (measured <= budget) r.ok(text);
  else r.fail(text + ' — over budget');
}

export function firstPaintOfHome(dist: string, cache: Map<string, number>): { total: number; items: [string, number][]; notes: string[] } {
  const home = join(dist, 'index.html');
  const html = readFileSync(home, 'utf8');
  const items: [string, number][] = [['index.html', transferSize(home, cache)]];
  const notes: string[] = [];
  const counted = new Set<string>([home]);
  const groups = new Map<number, string[]>();
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
  for (const ref of htmlRefs(html)) {
    if (!ref.resource) continue;
    if (ref.as === 'script' || ref.as === 'modulepreload' || ref.as === 'hint' || ref.as === 'frame' || ref.as === 'media') continue;
    const t = resolveRef(ref.url, '/', ref.where);
    if (!t) continue;
    if (ref.group !== undefined) {
      const g = groups.get(ref.group) ?? [];
      g.push(t);
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
  // An <img>/<picture> fetches one candidate: count the largest.
  for (const g of groups.values()) {
    const best = g.reduce((a, b) => (transferSize(b, cache) > transferSize(a, cache) ? b : a));
    add(best);
  }
  const total = items.reduce((a, [, n]) => a + n, 0);
  return { total, items, notes };
}

export function checkBudget(opts: BudgetOptions): Report {
  const r = new Report('budget');
  const dist = opts.dist;
  const exempt = opts.exempt ?? LEGACY_PASSTHROUGH;
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
    const isExempt = exempt.includes(urlPath);
    const third = [...new Set(scan.thirdParty)];
    if (isExempt) {
      r.exempt(`${urlPath} (legacy passthrough until P3): ${third.length} third-party request${third.length === 1 ? '' : 's'}, ${formatBytes(scan.jsBytes)} JavaScript — not enforced`);
      continue;
    }
    for (const t of third) r.fail(`${urlPath}: third-party request: ${t}`);
    if (third.length === 0) r.ok(`${urlPath}: no third-party request`);
    if (p !== 'index.html') row(r, `${urlPath}: JavaScript (raw, inline + referenced + imported)`, scan.jsBytes, BUDGETS.conventionalJs);
  }
  return r;
}

runCli(import.meta.url, {
  name: 'budget',
  summary: 'The static rows of REWRITE.md § E7: first paint of / ≤ 200 KB, stage scripts ≤ 2.2 MB, sound ≤ 400 KB, conventional pages ≤ 5 KB JS, no third-party request anywhere.',
  usesDist: true,
}, (o) => checkBudget({ dist: o.dist }));
