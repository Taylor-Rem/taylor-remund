// check-links: no broken internal reference (REWRITE.md § E8 "Site").
//
// Every internal href/src/srcset/CSS url() in built HTML and CSS resolves to
// a file in the build (a directory answers with its index.html), and every
// #fragment on an internal reference exists as an id (or <a name>) in the
// target. External references are listed and counted, never fetched.
// mailto:, tel:, data: and javascript: are skipped.

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { isDir, toPosix, walk } from './lib/fsutil.ts';
import { collectIds } from './lib/html.ts';
import { htmlRefs } from './lib/refs.ts';
import { cssRefs } from './lib/css.ts';
import { classify, resolveToFile, urlPathForFile } from './lib/urls.ts';

export interface LinksOptions {
  dist: string;
}

export interface Broken {
  from: string;
  target: string;
  why: string;
}

export function checkLinks(opts: LinksOptions): Report {
  const r = new Report('check-links');
  const dist = opts.dist;
  if (!isDir(dist)) {
    r.fail(`build output not found: ${dist} (run the build first)`);
    return r;
  }
  const files = walk(dist);
  const htmlFiles = files.filter((f) => f.endsWith('.html'));
  const cssFiles = files.filter((f) => f.endsWith('.css'));
  if (htmlFiles.length === 0) {
    r.fail('no HTML pages in the build');
    return r;
  }

  const idCache = new Map<string, Set<string>>();
  const idsOf = (abs: string): Set<string> => {
    let s = idCache.get(abs);
    if (!s) {
      s = collectIds(readFileSync(abs, 'utf8'), abs.endsWith('.html'));
      idCache.set(abs, s);
    }
    return s;
  };

  const broken: Broken[] = [];
  const external = new Map<string, number>();
  let internal = 0;
  let skipped = 0;

  const check = (fromLabel: string, baseUrl: string, ref: string): void => {
    if (ref.trim() === '') return;
    const c = classify(ref, baseUrl);
    if (c.kind === 'skip') {
      skipped++;
      return;
    }
    if (c.kind === 'external') {
      external.set(c.url, (external.get(c.url) ?? 0) + 1);
      return;
    }
    internal++;
    // `baseUrl` is the page's URL, or the stylesheet's own for CSS url();
    // a fragment-only reference points into the page itself.
    const target = resolveToFile(dist, c.path);
    if (!target) {
      broken.push({ from: fromLabel, target: ref, why: 'no such file' });
      return;
    }
    if (c.fragment !== null && /\.(html|svg)$/.test(target)) {
      if (!idsOf(target).has(c.fragment)) {
        const where = toPosix(relative(dist, target));
        broken.push({ from: fromLabel, target: ref, why: `no id "${c.fragment}" in ${where}` });
      }
    }
  };

  for (const rel of htmlFiles) {
    const abs = join(dist, rel);
    const urlPath = urlPathForFile(rel);
    const html = readFileSync(abs, 'utf8');
    for (const ref of htmlRefs(html)) {
      // 404.html is served at whatever URL was missed, so its own references
      // must not be relative to its location.
      if (rel === '404.html') {
        const u = ref.url.trim();
        if (u !== '' && !/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(u)) {
          broken.push({ from: urlPath, target: u, why: 'relative reference on 404.html (it is served at any missing URL); use a root-relative path' });
        }
      }
      check(urlPath, urlPath, ref.url);
    }
  }
  for (const rel of cssFiles) {
    const abs = join(dist, rel);
    const base = dirname(rel) === '.' ? '/' : '/' + toPosix(dirname(rel)) + '/';
    for (const ref of cssRefs(readFileSync(abs, 'utf8'))) check('/' + rel, base, ref.url);
  }

  for (const b of broken) r.fail(`${b.from} → ${b.target} (${b.why})`);
  r.info(`       ${htmlFiles.length} HTML and ${cssFiles.length} CSS file${cssFiles.length === 1 ? '' : 's'}; ${internal} internal references, ${skipped} mailto:/tel:/data: skipped`);
  const extTotal = [...external.values()].reduce((a, b) => a + b, 0);
  r.info(`       ${extTotal} external reference${extTotal === 1 ? '' : 's'} to ${external.size} URL${external.size === 1 ? '' : 's'} (not fetched; verify runs offline):`);
  for (const [u, n] of [...external.entries()].sort()) r.info(`         ${String(n).padStart(3)}× ${u}`);
  if (broken.length === 0) r.ok(`every internal reference resolves`);
  return r;
}

runCli(import.meta.url, {
  name: 'check-links',
  summary: 'No broken internal link: every href/src/srcset/url() in built HTML and CSS resolves to a file in the build, and every #fragment to an id.',
  usesDist: true,
}, (o) => checkLinks({ dist: o.dist }));
