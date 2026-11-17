// check-urls: nothing was lost (REWRITE.md § 2, § E8 "Site", § Cutover).
//
// Every path of § 2 answers from the built output; CNAME is intact; required
// anchors exist; robots metas are as published; /career-send/ stays unlinked
// and out of the sitemap; every page's footer links the three legal pages;
// /sms/ shows the service number; /ai/ keeps every mailto: and every price.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { isDir, isFile, walk } from './lib/fsutil.ts';
import { attr, findElements, robotsMetas, scanTags, collectIds, visibleText } from './lib/html.ts';
import { htmlRefs } from './lib/refs.ts';
import { canonicalPagePath, classify, urlPathForFile } from './lib/urls.ts';
import { readLegacy } from './lib/legacy.ts';
import {
  ASSETS, CNAME_DOMAIN, FOOTER_REQUIRED, PAGES, SMS_NUMBER, pageByPath,
} from './site.ts';
import type { PageSpec } from './site.ts';

export interface UrlsOptions {
  dist: string;
  /** Repository root: holds CNAME, src/dev-pages/, legacy/ (and the git history). */
  root: string;
}

export interface BuiltPage {
  rel: string;
  urlPath: string;
  html: string;
}

export function builtPages(dist: string): BuiltPage[] {
  return walk(dist)
    .filter((f) => f.endsWith('.html'))
    .map((rel) => ({ rel, urlPath: urlPathForFile(rel), html: readFileSync(join(dist, rel), 'utf8') }));
}

/** Multiset as sorted array. */
function sorted(xs: string[]): string[] {
  return [...xs].sort();
}

/** Items in `a` not matched in `b` (multiset difference). */
export function multisetMinus(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const c = counts.get(x) ?? 0;
    if (c > 0) counts.set(x, c - 1);
    else out.push(x);
  }
  return out;
}

/** Every mailto: href on the page, entities decoded, exactly as written otherwise. */
export function mailtoHrefs(html: string): string[] {
  const out: string[] = [];
  for (const t of scanTags(html)) {
    if (t.closing) continue;
    const h = attr(t, 'href');
    if (h !== undefined && /^\s*mailto:/i.test(h)) out.push(h.trim());
  }
  return sorted(out);
}

const PRICE_RE = /\$\d[\d,]*(?:\.\d{2})?(?:\s*\/\s*(?:mo|month|hr|hour|yr|year)\b)?/g;

/** Every price string in the visible text and the meta description (`$150`, `$1,500`, `$79/mo`). */
export function priceStrings(html: string): string[] {
  let text = visibleText(html);
  for (const t of scanTags(html)) {
    if (!t.closing && t.name === 'meta' && (attr(t, 'name') ?? '').toLowerCase() === 'description') {
      text += ' ' + (attr(t, 'content') ?? '');
    }
  }
  return sorted((text.match(PRICE_RE) ?? []).map((p) => p.replace(/\s+/g, '')));
}

function describeMultisetDiff(r: Report, label: string, built: string[], legacy: string[]): void {
  const missing = multisetMinus(legacy, built);
  const extra = multisetMinus(built, legacy);
  for (const m of missing) r.fail(`/ai/: ${label} on the legacy page is missing from the build: ${m}`);
  for (const e of extra) r.fail(`/ai/: ${label} in the build is not on the legacy page: ${e}`);
  if (missing.length === 0 && extra.length === 0) r.ok(`/ai/: ${built.length} ${label}s equal the legacy page's`);
}

function fileFor(dist: string, p: { file: string }): string {
  return join(dist, p.file);
}

export function checkPathsAnswer(r: Report, dist: string): void {
  for (const p of PAGES) {
    if (isFile(fileFor(dist, p))) r.ok(`${p.path} answers (${p.file})`);
    else r.fail(`${p.path} does not answer: ${p.file} missing from the build`);
  }
  for (const a of ASSETS) {
    const f = join(dist, a.slice(1));
    if (isFile(f)) r.ok(`${a} answers`);
    else r.fail(`${a} does not answer: ${a.slice(1)} missing from the build`);
  }
  // /resume without the slash: a directory answers it on GitHub Pages.
  if (isDir(join(dist, 'resume')) && isFile(join(dist, 'resume', 'index.html'))) r.ok('/resume (no slash) answers as a directory');
  else r.fail('/resume (no slash) does not answer: dist/resume/ is not a directory with index.html');
}

export function checkCname(r: Report, dist: string, root: string): void {
  const srcPath = join(root, 'CNAME');
  const outPath = join(dist, 'CNAME');
  if (!isFile(srcPath)) {
    r.fail(`repository CNAME missing at ${srcPath}`);
    return;
  }
  const src = readFileSync(srcPath);
  const text = src.toString('latin1');
  if (text !== CNAME_DOMAIN && text !== CNAME_DOMAIN + '\n') {
    r.fail(`repository CNAME content is ${JSON.stringify(src.toString('latin1'))}, expected "${CNAME_DOMAIN}" and at most a newline`);
  }
  if (!isFile(outPath)) return; // reported by checkPathsAnswer
  const out = readFileSync(outPath);
  if (!out.equals(src)) r.fail(`dist/CNAME (${JSON.stringify(out.toString('latin1'))}) is not byte-identical to the repository CNAME (${JSON.stringify(src.toString('latin1'))})`);
  else r.ok(`dist/CNAME is byte-identical to CNAME (${JSON.stringify(out.toString('latin1'))})`);
}

export function checkAnchors(r: Report, dist: string): void {
  for (const p of PAGES) {
    if (p.anchors.length === 0 || !isFile(fileFor(dist, p))) continue;
    const ids = collectIds(readFileSync(fileFor(dist, p), 'utf8'));
    const missing = p.anchors.filter((a) => !ids.has(a));
    for (const m of missing) r.fail(`${p.path}: required anchor #${m} missing (no id="${m}")`);
    if (missing.length === 0) r.ok(`${p.path}: anchors ${p.anchors.map((a) => '#' + a).join(' ')}`);
  }
}

export function checkRobots(r: Report, dist: string): void {
  for (const p of PAGES) {
    if (p.robots === 'unchecked' || !isFile(fileFor(dist, p))) continue;
    const metas = robotsMetas(readFileSync(fileFor(dist, p), 'utf8'));
    if (p.robots === 'none') {
      if (metas.length === 0) r.ok(`${p.path}: no robots meta, as published`);
      else r.fail(`${p.path}: has robots meta ${metas.map((m) => JSON.stringify(m)).join(', ')}; as published it has none`);
    } else {
      const want = p.robots.content;
      if (metas.length === 1 && metas[0] === want) r.ok(`${p.path}: robots "${want}"`);
      else if (metas.length === 0) r.fail(`${p.path}: robots meta missing; expected content="${want}"`);
      else r.fail(`${p.path}: robots meta ${metas.map((m) => JSON.stringify(m)).join(', ')}; expected exactly one, content="${want}"`);
    }
  }
}

export function checkUnlinked(r: Report, dist: string, pages: BuiltPage[]): void {
  const unlinked = PAGES.filter((p) => p.unlinked);
  for (const u of unlinked) {
    let hits = 0;
    for (const pg of pages) {
      if (pg.rel === u.file) continue;
      for (const ref of htmlRefs(pg.html)) {
        const c = classify(ref.url, pg.urlPath);
        if (c.kind === 'internal' && canonicalPagePath(c.path) === u.path) {
          hits++;
          r.fail(`${pg.urlPath} links ${u.path} (${ref.where} "${ref.url}"); it must stay unlinked`);
        }
      }
    }
    if (hits === 0) r.ok(`no page links ${u.path}`);
  }
  // Sitemaps list neither the unlinked page nor any noindex page.
  const noindex = new Set<string>();
  for (const p of PAGES) if (typeof p.robots === 'object' && /noindex/i.test(p.robots.content)) noindex.add(p.path);
  for (const pg of pages) if (robotsMetas(pg.html).some((m) => /noindex/i.test(m))) noindex.add(canonicalPagePath(pg.urlPath));
  for (const u of unlinked) noindex.add(u.path);
  const maps = walk(dist).filter((f) => /(^|\/)sitemap[^/]*\.xml$/i.test(f));
  if (maps.length === 0) r.note('no sitemap*.xml in the build');
  for (const m of maps) {
    const xml = readFileSync(join(dist, m), 'utf8');
    const locs = [...xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)].map((x) => x[1]);
    let bad = 0;
    for (const loc of locs) {
      const c = classify(loc.replace(/&amp;/g, '&'), '/');
      if (c.kind === 'internal' && noindex.has(canonicalPagePath(c.path))) {
        bad++;
        r.fail(`${m} lists ${loc}, which is unlinked or noindex`);
      }
    }
    if (bad === 0) r.ok(`${m}: ${locs.length} locations, none unlinked or noindex`);
  }
}

/** Internal page paths (canonical) the page's <footer> links. */
export function footerLinks(html: string, urlPath: string): Set<string> {
  const tags = scanTags(html);
  const out = new Set<string>();
  for (const f of findElements(html, (t) => t.name === 'footer', tags)) {
    const inner = html.slice(f.start, f.end < 0 ? html.length : f.end);
    for (const ref of htmlRefs(inner)) {
      if (ref.as !== 'link') continue;
      const c = classify(ref.url, urlPath);
      if (c.kind === 'internal') out.add(canonicalPagePath(c.path));
    }
  }
  return out;
}

export function checkFooters(r: Report, pages: BuiltPage[]): void {
  if (pages.length === 0) {
    r.fail('no HTML pages in the build');
    return;
  }
  for (const pg of pages) {
    const hasFooter = scanTags(pg.html).some((t) => !t.closing && t.name === 'footer');
    if (!hasFooter) {
      r.fail(`${pg.urlPath}: no <footer> element (it must link ${FOOTER_REQUIRED.join(' ')})`);
      continue;
    }
    const links = footerLinks(pg.html, pg.urlPath);
    const missing = FOOTER_REQUIRED.filter((p) => !links.has(p));
    for (const m of missing) r.fail(`${pg.urlPath}: footer does not link ${m}`);
  }
  r.ok(`footers checked on ${pages.length} page${pages.length === 1 ? '' : 's'}`);
}

export function checkSms(r: Report, dist: string): void {
  const p = pageByPath('/sms/') as PageSpec;
  if (!isFile(fileFor(dist, p))) return;
  const html = readFileSync(fileFor(dist, p), 'utf8');
  if (visibleText(html).includes(SMS_NUMBER)) r.ok(`/sms/ shows ${SMS_NUMBER}`);
  else r.fail(`/sms/ does not show the service number ${SMS_NUMBER}`);
  const linked = new Set<string>();
  for (const ref of htmlRefs(html)) {
    if (ref.as !== 'link') continue;
    const c = classify(ref.url, p.path);
    if (c.kind === 'internal') linked.add(canonicalPagePath(c.path));
  }
  for (const need of ['/privacy/', '/terms/']) {
    if (linked.has(need)) r.ok(`/sms/ links ${need}`);
    else r.fail(`/sms/ does not link ${need}`);
  }
}

export function checkAiParity(r: Report, dist: string, root: string): void {
  const p = pageByPath('/ai/') as PageSpec;
  if (!isFile(fileFor(dist, p))) return;
  const legacy = readLegacy(root, p.legacyFile as string);
  if (!legacy) {
    r.fail(`/ai/: legacy page ${p.legacyFile} not found (neither legacy/${p.legacyFile} nor the git commit); cannot compare mailto: and prices`);
    return;
  }
  const built = readFileSync(fileFor(dist, p), 'utf8');
  const old = legacy.bytes.toString('utf8');
  r.info(`       /ai/ compared with ${legacy.from}`);
  describeMultisetDiff(r, 'mailto: href', mailtoHrefs(built), mailtoHrefs(old));
  const oldPrices = priceStrings(old);
  if (oldPrices.length === 0) r.fail('/ai/: no price strings found on the legacy page; the price pattern is broken');
  describeMultisetDiff(r, 'price', priceStrings(built), oldPrices);
}

export function checkPassthrough(r: Report, dist: string, root: string): void {
  for (const p of PAGES) {
    if (!p.legacyPassthrough || !isFile(fileFor(dist, p))) continue;
    const legacy = readLegacy(root, p.legacyFile as string);
    if (!legacy) {
      r.fail(`${p.path}: legacy passthrough source ${p.legacyFile} not found`);
      continue;
    }
    if (readFileSync(fileFor(dist, p)).equals(legacy.bytes)) r.ok(`${p.path}: byte-identical passthrough of ${legacy.from}`);
    else r.fail(`${p.path}: listed as legacy passthrough but differs from ${legacy.from}`);
  }
}

export function checkNoDevPages(r: Report, dist: string, root: string): void {
  let bad = 0;
  for (const d of ['dev', 'dev.html', 'dev-pages']) {
    if (isDir(join(dist, d)) || isFile(join(dist, d))) {
      bad++;
      r.fail(`dist/${d} exists; development pages must not be in a normal build`);
    }
  }
  const devSrc = join(root, 'src', 'dev-pages');
  const sources = walk(devSrc);
  for (const s of sources) {
    const stem = s.replace(/\.[^/.]+$/, '');
    const candidates = new Set<string>([`${stem}.html`, `${stem}/index.html`]);
    if (stem === 'index') candidates.delete('index.html');
    if (stem.endsWith('/index')) candidates.add(`${stem.slice(0, -'/index'.length)}/index.html`);
    for (const c of candidates) {
      if (isFile(join(dist, c))) {
        bad++;
        r.fail(`dist/${c} looks built from src/dev-pages/${s}; development pages must not be in a normal build`);
      }
    }
  }
  if (bad === 0) r.ok(`no dev/ output and none of ${sources.length} src/dev-pages file${sources.length === 1 ? '' : 's'} built`);
}

export function checkUrls(opts: UrlsOptions): Report {
  const r = new Report('check-urls');
  if (!isDir(opts.dist)) {
    r.fail(`build output not found: ${opts.dist} (run the build first)`);
    return r;
  }
  const pages = builtPages(opts.dist);
  checkPathsAnswer(r, opts.dist);
  checkCname(r, opts.dist, opts.root);
  checkAnchors(r, opts.dist);
  checkRobots(r, opts.dist);
  checkUnlinked(r, opts.dist, pages);
  checkFooters(r, pages);
  checkSms(r, opts.dist);
  checkAiParity(r, opts.dist, opts.root);
  checkPassthrough(r, opts.dist, opts.root);
  checkNoDevPages(r, opts.dist, opts.root);
  return r;
}

runCli(import.meta.url, {
  name: 'check-urls',
  summary: 'Nothing was lost: every path of REWRITE.md § 2 answers from the build, with its anchors, robots meta, footer links and /ai/ prices.',
  usesDist: true,
}, checkUrls);
