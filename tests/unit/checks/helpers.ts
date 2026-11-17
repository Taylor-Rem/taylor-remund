// Fixture builders for the check-script tests. Each test gets a fresh temp
// directory holding a fake repository root and a fake dist/.

import { afterAll } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitShow } from '../../../scripts/lib/legacy.ts';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const made: string[] = [];

/** A fresh temp directory, removed when the test file finishes. */
export function tmp(prefix = 'x-'): string {
  const d = mkdtempSync(join(tmpdir(), `trc-checks-${prefix}`));
  made.push(d);
  return d;
}

afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function write(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

export function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** A file from the published site at fa99b13. */
export function legacy(path: string): Buffer {
  const b = gitShow(REPO, path);
  if (!b) throw new Error(`fixture needs git commit fa99b13 (${path})`);
  return b;
}

const FOOTER = `<footer class="footer"><p class="footer-links"><a href="/privacy/">Privacy</a> <a href="/terms/">Terms</a> <a href="/sms/">SMS</a></p></footer>`;

export function paperPage(title: string, body: string, opts: { robots?: string; footer?: string } = {}): string {
  const robots = opts.robots ? `\n  <meta name="robots" content="${opts.robots}">` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>${robots}
  <link rel="stylesheet" href="/styles/paper.css">
</head>
<body>
  <nav><a href="/">Home</a> <a href="/resume/">Résumé</a> <a href="/ai/">Services</a></nav>
  <main>
    ${body}
  </main>
  ${opts.footer ?? FOOTER}
</body>
</html>
`;
}

export const HOME_BODY = `<section id="patchlamp"><h2>Patchlamp</h2>
      <picture>
        <source type="image/webp" srcset="/assets/exchange-room-640.webp 640w, /assets/exchange-room-1280.webp 1280w" sizes="520px">
        <img src="/assets/exchange-room-1280.jpg" alt="" width="1280" height="853">
      </picture></section>
    <section id="services"><a href="/ai/#packages">Services</a></section>
    <section id="about"><img src="/assets/taylor.jpg" alt="" width="220" height="220"><a href="/resume/#experience">Résumé</a></section>
    <section id="contact"><a href="mailto:remundtaylor3@gmail.com">Email</a></section>`;

export interface Site {
  root: string;
  dist: string;
  refDir: string;
}

/**
 * A minimal site that passes every dist check: Paper pages for /, the four
 * compliance pages and 404; /resume/ and /ai/ as legacy passthrough; the
 * assets of § 2. The fake root holds CNAME, legal-reference/ and legacy/.
 */
export function makeSite(): Site {
  const root = tmp('site-');
  const dist = join(root, 'dist');
  const refDir = join(root, 'legal-reference');
  cpSync(join(REPO, 'legal-reference'), refDir, { recursive: true });
  write(join(root, 'CNAME'), readFileSync(join(REPO, 'CNAME')));
  for (const p of ['ai/index.html', 'resume/index.html', 'style.css', 'script.js']) write(join(root, 'legacy', p), legacy(p));

  write(join(dist, 'CNAME'), readFileSync(join(REPO, 'CNAME')));
  write(join(dist, 'index.html'), paperPage('Taylor Remund', HOME_BODY));
  write(join(dist, 'styles/paper.css'), 'body{margin:0;font-family:system-ui}\n');
  // Legacy passthrough pages and what they reference.
  for (const p of ['ai/index.html', 'resume/index.html', 'style.css', 'script.js']) write(join(dist, p), legacy(p));
  for (const a of ['og.png', 'taylor.jpg', 'icons.svg', 'exchange-room-1280.jpg', 'exchange-room-1280.webp', 'exchange-room-640.jpg', 'exchange-room-640.webp']) {
    write(join(dist, 'assets', a), legacy(`assets/${a}`));
  }
  const wrap = (name: string): string => read(join(refDir, `${name}.html`));
  write(join(dist, 'privacy/index.html'), paperPage('Privacy', `<section class="section legal-page" id="privacy">\n    ${wrap('privacy')}\n  </section>`, { robots: 'noindex, follow' }));
  write(join(dist, 'terms/index.html'), paperPage('Terms', `<section class="section legal-page" id="terms">\n    ${wrap('terms')}\n  </section>`, { robots: 'noindex, follow' }));
  write(join(dist, 'sms/index.html'), paperPage('SMS', `<section class="section legal-page" id="sms">\n    ${wrap('sms')}\n  </section>`));
  write(join(dist, 'career-send/index.html'), paperPage('Career Send', `<section class="section legal-page" id="career-send">\n    ${wrap('career-send')}\n  </section>`, { robots: 'noindex, follow' }));
  write(join(dist, '404.html'), paperPage('Not here', '<h1>Nothing at this bench.</h1><a href="/">Home</a>'));
  return { root, dist, refDir };
}

/** Replace exactly one occurrence of `from` in a file (throws when absent). */
export function edit(path: string, from: string, to: string): void {
  const s = read(path);
  const i = s.indexOf(from);
  if (i < 0) throw new Error(`edit: ${JSON.stringify(from)} not in ${path}`);
  writeFileSync(path, s.slice(0, i) + to + s.slice(i + from.length));
}
