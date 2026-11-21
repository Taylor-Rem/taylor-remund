// check-text: each conventional page says what the live page says (gate G3,
// REWRITE.md § G "P3": "each conventional page's visible text matches main's,
// apart from a written list of intended differences").
//
// For each page in TEXT_PAGES it compares the built dist/<page> with the live
// page of record, legacy/<page> (falling back to `git show fa99b13:<page>`):
//
//   text   the visible words of the page's content, in order (a word-level
//          diff; whitespace collapsed, entities decoded; an unknown entity is
//          an error, never a pass)
//   head   <title>, meta description, robots, every og: tag
//   link   every link in the content: its text (or, for an icon link, its
//          aria-label or title) and its target. Relative, root-relative and
//          absolute forms of the same path are equal; a mailto: compares the
//          address AND every parameter (the subject)
//   alt    every non-empty image alt text in the content, in order
//   anchor every id REWRITE.md § 2 lists for the page (scripts/site.ts); a
//          missing one fails outright and cannot be listed away
//
// The furniture (everything outside <main> on a new page; the <nav> and
// <footer> on a live one) is compared as its own item: its differences are
// listed once under page "furniture", whatever page they occur on.
//
// Every difference must be matched by an entry in scripts/text-differences.json
// (page, item, live, new, why, approval). An unlisted difference fails; a listed
// one that no longer occurs fails too, so the list never goes stale.
// A page still served byte for byte from legacy/ is reported "not migrated".
//
//   node scripts/check-text.ts            the check
//   node scripts/check-text.ts --list     the list, as a table for a person to read
//
// To add a page: one line in TEXT_PAGES.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Report } from './lib/report.ts';
import { isMain, parseCli } from './lib/cli.ts';
import type { CliSpec } from './lib/cli.ts';
import { isDir, isFile } from './lib/fsutil.ts';
import { attr, decodeEntities, findElements, scanTags } from './lib/html.ts';
import type { Tag } from './lib/html.ts';
import { canonicalPagePath, classify } from './lib/urls.ts';
import { readLegacy } from './lib/legacy.ts';
import { pageByPath } from './site.ts';

// ---- The pages (add a page here) ---------------------------------------------

export interface TextPage {
  /** URL path (`/resume/`). */
  path: string;
  /** Built file under dist/. */
  file: string;
  /** The live page of record, under legacy/ (or at fa99b13). */
  legacy: string;
  /** `full`: content, head, links, alts, anchors, furniture. `head`: head and furniture only (the compliance pages, whose content check-legal holds byte for byte). */
  compare: 'full' | 'head';
}

export const TEXT_PAGES: readonly TextPage[] = [
  { path: '/resume/', file: 'resume/index.html', legacy: 'resume/index.html', compare: 'full' },
  { path: '/ai/', file: 'ai/index.html', legacy: 'ai/index.html', compare: 'full' },
  { path: '/case-studies/ledger-repair/', file: 'case-studies/ledger-repair/index.html', legacy: 'case-studies/ledger-repair/index.html', compare: 'full' },
  { path: '/privacy/', file: 'privacy/index.html', legacy: 'privacy/index.html', compare: 'head' },
  { path: '/terms/', file: 'terms/index.html', legacy: 'terms/index.html', compare: 'head' },
  { path: '/sms/', file: 'sms/index.html', legacy: 'sms/index.html', compare: 'head' },
  { path: '/career-send/', file: 'career-send/index.html', legacy: 'career-send/index.html', compare: 'head' },
];

export const DIFFERENCES_FILE = 'scripts/text-differences.json';
export const APPROVALS = ['correction of a wrong fact, REWRITE.md § 3', 'structural, no words', 'pending Taylor'] as const;
export const ITEMS = ['text', 'head', 'link', 'alt', 'furniture text', 'furniture link'] as const;
export type Item = (typeof ITEMS)[number];
/** The page name furniture differences are listed under. */
export const FURNITURE = 'furniture';

// ---- Reading a page -----------------------------------------------------------

/** Elements whose start and end do not separate words (phrasing content). */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp',
  'small', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);
/** Elements whose content is never visible text. */
const SKIPPED = new Set(['script', 'style', 'template', 'svg', 'noscript', 'head', 'title']);

export class EntityError extends Error {}

/** Throws EntityError when `raw` (HTML text) holds a character reference the decoder does not know. */
function assertEntities(raw: string, where: string): void {
  for (const m of raw.matchAll(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g)) {
    if (decodeEntities(m[0]) === m[0]) throw new EntityError(`unknown character reference ${m[0]} in ${where}`);
  }
}

/** The visible words of an HTML fragment, in order. Every non-phrasing tag separates words. */
export function words(fragment: string, where = 'page'): string[] {
  // Comments are not text (scanTags skips them, so they would read as words).
  const html = fragment.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
  const tags = scanTags(html);
  let out = '';
  let pos = 0;
  for (let k = 0; k < tags.length; k++) {
    const t = tags[k]!;
    const raw = html.slice(pos, t.start);
    assertEntities(raw, where);
    out += raw;
    pos = t.end;
    if (!t.closing && !t.selfClosing && SKIPPED.has(t.name)) {
      const close = findClose(tags, k);
      if (close >= 0) {
        k = close;
        pos = tags[close]!.end;
      }
    }
    if (!INLINE.has(t.name)) out += ' ';
  }
  const rest = html.slice(pos);
  assertEntities(rest, where);
  out += rest;
  return decodeEntities(out).split(/[\s ]+/).filter((w) => w !== '');
}

function findClose(tags: Tag[], k: number): number {
  const name = tags[k]!.name;
  let depth = 0;
  for (let m = k; m < tags.length; m++) {
    const u = tags[m]!;
    if (u.name !== name) continue;
    if (!u.closing && !u.selfClosing) depth++;
    else if (u.closing && --depth === 0) return m;
  }
  return -1;
}

/** The inner HTML of the first element named `name`, or null. */
function inner(html: string, name: string): string | null {
  const tags = scanTags(html);
  const k = tags.findIndex((t) => !t.closing && t.name === name);
  if (k < 0) return null;
  const close = findClose(tags, k);
  return html.slice(tags[k]!.end, close < 0 ? html.length : tags[close]!.start);
}

/** Removes every element named in `names` (with its content) from `html`. */
function without(html: string, names: readonly string[]): { rest: string; removed: string } {
  const tags = scanTags(html);
  let rest = '';
  let removed = '';
  let pos = 0;
  for (let k = 0; k < tags.length; k++) {
    const t = tags[k]!;
    if (t.closing || !names.includes(t.name) || t.start < pos) continue;
    const close = findClose(tags, k);
    const end = close < 0 ? html.length : tags[close]!.end;
    rest += html.slice(pos, t.start);
    removed += html.slice(t.start, end) + '\n';
    pos = end;
  }
  rest += html.slice(pos);
  return { rest, removed };
}

export interface Regions {
  content: string;
  furniture: string;
}

/**
 * A new page's content is its <main>; its furniture is the rest of <body>.
 * A live page (no <main>) has its <nav> and <footer> as furniture and the
 * rest of <body> as content.
 */
export function regions(html: string): Regions {
  const body = inner(html, 'body') ?? html;
  const main = inner(body, 'main');
  if (main !== null) return { content: main, furniture: without(body, ['main']).rest };
  const { rest, removed } = without(body, ['nav', 'footer']);
  return { content: rest, furniture: removed };
}

/** `name: value` lines for <title>, description, robots and every og: tag, sorted by name. */
export function headItems(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const head = inner(html, 'head') ?? html;
  const tags = scanTags(head);
  const t = tags.findIndex((x) => !x.closing && x.name === 'title');
  if (t >= 0) {
    const close = findClose(tags, t);
    const raw = head.slice(tags[t]!.end, close < 0 ? head.length : tags[close]!.start);
    assertEntities(raw, '<title>');
    out.set('title', decodeEntities(raw).replace(/\s+/g, ' ').trim());
  }
  for (const m of tags) {
    if (m.closing || m.name !== 'meta') continue;
    const name = (attr(m, 'name') ?? '').toLowerCase();
    const prop = (attr(m, 'property') ?? '').toLowerCase();
    const content = (attr(m, 'content') ?? '').replace(/\s+/g, ' ').trim();
    if (name === 'description' || name === 'robots') out.set(name, content);
    if (prop.startsWith('og:')) out.set(prop, content);
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** A link target in comparable form. */
export function target(href: string, pagePath: string): string {
  const h = href.trim();
  if (/^mailto:/i.test(h)) {
    const [addr = '', query = ''] = h.slice('mailto:'.length).split('?');
    const params = [...new URLSearchParams(query)].map(([k, v]) => `${k.toLowerCase()}=${v}`).sort();
    return `mailto:${decodeURIComponent(addr).toLowerCase()}${params.length ? ' ' + params.join(' ') : ''}`;
  }
  const c = classify(h, pagePath);
  if (c.kind === 'internal') {
    const path = canonicalPagePath(c.path);
    // A link within the page is its fragment, however it is written.
    if (path === canonicalPagePath(pagePath) && c.fragment) return `#${c.fragment}`;
    return path + (c.fragment ? `#${c.fragment}` : '');
  }
  if (c.kind === 'external') return c.url;
  return h;
}

/** Every link in a fragment as `text → target`; an icon link's text is its aria-label or title. */
export function links(html: string, pagePath: string): string[] {
  const tags = scanTags(html);
  return findElements(html, (t) => t.name === 'a' && t.attrs.has('href'), tags).map((e) => {
    const body = html.slice(e.tag.end, e.end < 0 ? html.length : e.end);
    const text = words(body.replace(/<\/a>\s*$/i, ''), 'a link').join(' ') || attr(e.tag, 'aria-label') || attr(e.tag, 'title') || '';
    return `${text} → ${target(attr(e.tag, 'href') ?? '', pagePath)}`;
  });
}

/** Every non-empty alt text, in order. */
export function alts(html: string): string[] {
  return scanTags(html)
    .filter((t) => !t.closing && t.name === 'img')
    .map((t) => (attr(t, 'alt') ?? '').trim())
    .filter((a) => a !== '');
}

// ---- Comparing ----------------------------------------------------------------

export interface Hunk {
  live: string;
  new: string;
  /** A few words before the hunk, for a person reading the report. */
  before: string;
}

/** The differing runs between two sequences (longest common subsequence). */
export function diff(a: readonly string[], b: readonly string[], join = ' '): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  // lcs[i][j] = LCS length of A[i..] and B[j..]
  const W = m + 1;
  const lcs = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * W + j] = A[i] === B[j] ? lcs[(i + 1) * W + j + 1]! + 1 : Math.max(lcs[(i + 1) * W + j]!, lcs[i * W + j + 1]!);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let del: string[] = [];
  let ins: string[] = [];
  let ctx: string[] = a.slice(Math.max(0, start - 5), start);
  const flush = (): void => {
    if (del.length || ins.length) hunks.push({ live: del.join(join), new: ins.join(join), before: ctx.slice(-5).join(join) });
    ctx = [...ctx, ...del].slice(-5);
    del = [];
    ins = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) {
      flush();
      ctx.push(A[i]!);
      if (ctx.length > 5) ctx = ctx.slice(-5);
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i * W + j + 1]! >= lcs[(i + 1) * W + j]!)) {
      ins.push(B[j++]!);
    } else {
      del.push(A[i++]!);
    }
  }
  flush();
  return hunks;
}

export interface Occurrence {
  page: string;
  item: Item;
  live: string;
  new: string;
  /** Where it was seen (pages, context). */
  where: string[];
}

export interface Listed {
  page: string;
  item: Item;
  live: string;
  new: string;
  why: string;
  approval: (typeof APPROVALS)[number];
}

function key(o: { page: string; item: string; live: string; new: string }): string {
  return JSON.stringify([o.page, o.item, o.live, o.new]);
}

class Occurrences {
  map = new Map<string, Occurrence>();
  add(page: string, item: Item, h: { live: string; new: string }, where: string): void {
    const k = key({ page, item, live: h.live, new: h.new });
    const o = this.map.get(k);
    if (o) o.where.push(where);
    else this.map.set(k, { page, item, live: h.live, new: h.new, where: [where] });
  }
}

function headHunks(live: Map<string, string>, built: Map<string, string>): Hunk[] {
  const out: Hunk[] = [];
  for (const k of new Set([...live.keys(), ...built.keys()])) {
    const a = live.get(k);
    const b = built.get(k);
    if (a !== b) out.push({ live: a === undefined ? '' : `${k}: ${a}`, new: b === undefined ? '' : `${k}: ${b}`, before: '' });
  }
  return out;
}

export interface TextOptions {
  dist: string;
  root: string;
  /** Defaults to <root>/scripts/text-differences.json. */
  differences?: string;
  /** Defaults to TEXT_PAGES. */
  pages?: readonly TextPage[];
}

export function readDifferences(file: string): Listed[] {
  const json = JSON.parse(readFileSync(file, 'utf8')) as { differences?: unknown };
  if (!Array.isArray(json.differences)) throw new Error(`${file}: expected { "differences": [...] }`);
  return json.differences as Listed[];
}

/** Problems with the list's own entries (missing fields, unknown approval or item, duplicates). */
export function listProblems(list: Listed[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  list.forEach((d, i) => {
    const at = `entry ${i} (${d.page} ${d.item})`;
    for (const f of ['page', 'item', 'live', 'new', 'why', 'approval'] as const) {
      if (typeof d[f] !== 'string') out.push(`${at}: "${f}" must be a string`);
    }
    if (typeof d.why === 'string' && d.why.trim() === '') out.push(`${at}: "why" is empty`);
    if (!(APPROVALS as readonly string[]).includes(d.approval)) out.push(`${at}: "approval" must be one of ${APPROVALS.map((a) => JSON.stringify(a)).join(', ')}`);
    if (!(ITEMS as readonly string[]).includes(d.item)) out.push(`${at}: "item" must be one of ${ITEMS.join(', ')}`);
    if (d.live === d.new) out.push(`${at}: "live" and "new" are the same`);
    const k = key(d);
    if (seen.has(k)) out.push(`${at}: listed twice`);
    seen.add(k);
  });
  return out;
}

export function checkText(opts: TextOptions): Report {
  const r = new Report('check-text');
  if (!isDir(opts.dist)) {
    r.fail(`build output not found: ${opts.dist} (run the build first)`);
    return r;
  }
  const listFile = opts.differences ?? join(opts.root, DIFFERENCES_FILE);
  let list: Listed[] = [];
  try {
    list = readDifferences(listFile);
  } catch (e) {
    r.fail(`cannot read the list of differences: ${(e as Error).message}`);
    return r;
  }
  for (const p of listProblems(list)) r.fail(`${DIFFERENCES_FILE}: ${p}`);

  const occ = new Occurrences();
  const compared = new Set<string>([FURNITURE]);
  const notMigrated = new Set<string>();
  for (const p of opts.pages ?? TEXT_PAGES) {
    const builtFile = join(opts.dist, p.file);
    if (!isFile(builtFile)) {
      r.fail(`${p.path}: ${p.file} is not in the build`);
      continue;
    }
    const legacy = readLegacy(opts.root, p.legacy);
    if (!legacy) {
      r.fail(`${p.path}: the live page ${p.legacy} is not in legacy/ nor at the record commit`);
      continue;
    }
    const builtBytes = readFileSync(builtFile);
    if (builtBytes.equals(legacy.bytes)) {
      r.note(`${p.path}: not migrated (served byte for byte from ${legacy.from}); nothing compared`);
      notMigrated.add(p.path);
      continue;
    }
    const built = builtBytes.toString('utf8');
    const old = legacy.bytes.toString('utf8');
    compared.add(p.path);
    const before = occ.map.size;
    try {
      const B = regions(built);
      const L = regions(old);
      for (const h of headHunks(headItems(old), headItems(built))) occ.add(p.path, 'head', h, p.path);
      // The furniture is compared whole: one entry per distinct pair, whatever pages share it.
      const lf = words(L.furniture, `${legacy.from} furniture`).join(' ');
      const bf = words(B.furniture, `${p.file} furniture`).join(' ');
      if (lf !== bf) occ.add(FURNITURE, 'furniture text', { live: lf, new: bf }, p.path);
      const ll = links(L.furniture, p.path).join(' | ');
      const bl = links(B.furniture, p.path).join(' | ');
      if (ll !== bl) occ.add(FURNITURE, 'furniture link', { live: ll, new: bl }, p.path);
      if (p.compare === 'full') {
        const lw = words(L.content, legacy.from);
        const bw = words(B.content, p.file);
        for (const h of diff(lw, bw)) occ.add(p.path, 'text', h, `after "${h.before}"`);
        for (const h of diff(links(L.content, p.path), links(B.content, p.path), ' | ')) occ.add(p.path, 'link', h, `after "${h.before}"`);
        for (const h of diff(alts(L.content), alts(B.content), ' | ')) occ.add(p.path, 'alt', h, p.path);
        const anchors = pageByPath(p.path)?.anchors ?? [];
        const ids = new Set(scanTags(built).filter((t) => !t.closing).map((t) => attr(t, 'id')).filter((x): x is string => x !== undefined));
        const missing = anchors.filter((a) => !ids.has(a));
        for (const a of missing) r.fail(`${p.path}: anchor #${a} (REWRITE.md § 2) is missing`);
        r.ok(`${p.path}: ${bw.length} words against ${lw.length} live (${legacy.from})${anchors.length ? `; anchors ${anchors.map((a) => '#' + a).join(' ')}${missing.length ? ' INCOMPLETE' : ''}` : ''}`);
      } else {
        r.ok(`${p.path}: head and furniture compared (content: check-legal)`);
      }
    } catch (e) {
      if (e instanceof EntityError) r.fail(`${p.path}: ${e.message}`);
      else throw e;
    }
    if (occ.map.size === before) r.ok(`${p.path}: no new difference`);
  }

  const listed = new Map(list.map((d) => [key(d), d]));
  let unlisted = 0;
  for (const o of occ.map.values()) {
    const d = listed.get(key(o));
    if (d) {
      r.ok(`listed (${d.approval}): ${o.page} ${o.item}: ${JSON.stringify(o.live)} → ${JSON.stringify(o.new)}`);
      continue;
    }
    unlisted++;
    r.fail(`${o.page} ${o.item}: a difference not in ${DIFFERENCES_FILE} (seen ${o.where.join('; ')})\n         live: ${JSON.stringify(o.live)}\n         new:  ${JSON.stringify(o.new)}\n         to list it: ${JSON.stringify({ page: o.page, item: o.item, live: o.live, new: o.new, why: '', approval: '' })}`);
  }
  for (const d of list) {
    if (occ.map.has(key(d))) continue;
    if (notMigrated.has(d.page)) r.fail(`${DIFFERENCES_FILE}: listed for ${d.page}, which is not migrated yet: ${JSON.stringify(d.live)} → ${JSON.stringify(d.new)}`);
    else if (!compared.has(d.page)) r.fail(`${DIFFERENCES_FILE}: listed for ${d.page}, which this check does not compare`);
    else r.fail(`${DIFFERENCES_FILE}: listed but no longer occurs (remove it): ${d.page} ${d.item}: ${JSON.stringify(d.live)} → ${JSON.stringify(d.new)}`);
  }
  r.info(`       ${occ.map.size} difference${occ.map.size === 1 ? '' : 's'} found, ${occ.map.size - unlisted} listed; ${list.length} entr${list.length === 1 ? 'y' : 'ies'} in ${DIFFERENCES_FILE}; not migrated: ${[...notMigrated].join(' ') || 'none'}`);
  return r;
}

/** The list as a table a person can read (for Taylor at the gate). */
export function formatList(list: Listed[]): string {
  const out: string[] = [];
  const byPage = new Map<string, Listed[]>();
  for (const d of list) byPage.set(d.page, [...(byPage.get(d.page) ?? []), d]);
  let n = 0;
  for (const [page, ds] of byPage) {
    out.push('', `${page}`, '-'.repeat(page.length));
    for (const d of ds) {
      n++;
      out.push(`${String(n).padStart(3)}. ${d.item}  [${d.approval}]`);
      out.push(`     live: ${d.live === '' ? '(nothing)' : d.live}`);
      out.push(`     new:  ${d.new === '' ? '(nothing)' : d.new}`);
      out.push(`     why:  ${d.why}`);
    }
  }
  const pending = list.filter((d) => d.approval === 'pending Taylor').length;
  out.unshift(`Intended differences between the new pages and the live ones (${DIFFERENCES_FILE}): ${list.length}, of which ${pending} pending Taylor.`);
  return out.join('\n');
}

const SPEC: CliSpec = {
  name: 'check-text',
  summary: "Each conventional page's visible text, head, links, alts and anchors match the live page's, apart from the listed differences (scripts/text-differences.json). --list prints that list as a table.",
  usesDist: true,
};

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const listMode = argv.includes('--list');
  const opts = parseCli(argv.filter((a) => a !== '--list'), SPEC);
  if (typeof opts === 'number') {
    if (opts === 0) console.log('  --list         print the list of intended differences as a table, and exit');
    process.exit(opts);
  }
  if (listMode) {
    try {
      const list = readDifferences(join(opts.root, DIFFERENCES_FILE));
      console.log(formatList(list));
      const problems = listProblems(list);
      for (const p of problems) console.error(`check-text: ${p}`);
      process.exit(problems.length ? 1 : 0);
    } catch (e) {
      console.error(`check-text: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  let report: Report;
  try {
    report = checkText(opts);
  } catch (err) {
    console.error(`check-text: internal error: ${(err as Error).stack ?? err}`);
    process.exit(1);
  }
  report.print();
  process.exit(report.exitCode);
}

