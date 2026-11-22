import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { checkText, diff, formatList, headItems, links, listProblems, regions, target, words } from '../../../scripts/check-text.ts';
import type { Listed, TextPage } from '../../../scripts/check-text.ts';
import { tmp, write } from './helpers.ts';

const fails = (r: { failures: string[] }): string => r.failures.join('\n');

const LIVE = `<!DOCTYPE html><html><head><title>Taylor Remund &mdash; Résumé</title>
<meta name="description" content="The engineer's view.">
<meta property="og:title" content="Résumé"></head><body>
<nav><a href="../" class="nav-logo">Taylor <span>Remund</span></a><a href="#projects">Projects</a></nav>
<!-- ===== ABOUT ===== -->
<section id="about"><h1>The engineer's view</h1><p>I build and run <a href="../#patchlamp">Patchlamp</a>.</p>
<img src="../assets/taylor.jpg" alt="Taylor Remund"><img src="x.svg" alt=""></section>
<section id="skills"></section><section id="projects"><div id="patchlamp"></div><div class="tags"><span>PHP</span><span>Rust</span></div>
<a href="https://github.com/Taylor-Rem/artificer" title="View on GitHub"><svg><title>GitHub</title></svg></a></section>
<section id="experience"></section><section id="contact"><a href="mailto:remundtaylor3@gmail.com?subject=AI%20Working%20Session" aria-label="Email"></a></section>
<footer><p>Taylor Remund &middot; 2026</p></footer>
</body></html>`;

const BUILT = `<!DOCTYPE html><html><head><title>Taylor Remund — Résumé</title>
<meta name="description" content="The engineer's view."><link rel="canonical" href="https://taylorremund.com/resume/">
<meta property="og:title" content="Résumé"></head><body>
<header><a href="/">Taylor Remund</a><nav><a href="/resume/#projects">Projects</a></nav></header>
<main id="content">
<section id="about"><h1>The engineer&#39;s view</h1><p>I build and run <a href="/#patchlamp">Patchlamp</a>.</p>
<img src="/assets/taylor.jpg" alt="Taylor Remund"></section>
<section id="skills"></section><section id="projects"><div id="patchlamp"></div><ul class="tags"><li>PHP</li><li>Rust</li></ul>
<a href="https://github.com/Taylor-Rem/artificer" title="View on GitHub"><svg aria-hidden="true"><use href="#gh"/></svg></a></section>
<section id="experience"></section><section id="contact"><a href="mailto:remundtaylor3@gmail.com?subject=AI Working Session" aria-label="Email"><svg></svg></a></section>
</main>
<footer><p>Taylor Remund · 2026</p></footer>
</body></html>`;

const PAGES: TextPage[] = [{ path: '/resume/', file: 'resume/index.html', legacy: 'resume/index.html', compare: 'full' }];

function site(built = BUILT, list: Listed[] = []): { root: string; dist: string } {
  const root = tmp('text-');
  const dist = join(root, 'dist');
  write(join(root, 'legacy/resume/index.html'), LIVE);
  write(join(dist, 'resume/index.html'), built);
  write(join(root, 'scripts/text-differences.json'), JSON.stringify({ differences: list }));
  return { root, dist };
}

const run = (s: { root: string; dist: string }) => checkText({ dist: s.dist, root: s.root, pages: PAGES });

describe('check-text', () => {
  it('passes a page whose text, head, links, alts and furniture match the live page', () => {
    const r = run(site());
    expect(r.failures).toEqual([]);
    expect(r.render()).toMatch(/\/resume\/: \d+ words against \d+ live/);
  });

  it('fails on a changed word, and says what to list', () => {
    const r = run(site(BUILT.replace('I build and run', 'I build and operate')));
    expect(fails(r)).toMatch(/\/resume\/ text: a difference not in scripts\/text-differences\.json/);
    expect(fails(r)).toMatch(/live: "run"\n\s+new: {2}"operate"/);
  });

  it('passes a listed change', () => {
    const r = run(site(BUILT.replace('I build and run', 'I build and operate'), [
      { page: '/resume/', item: 'text', live: 'run', new: 'operate', why: 'test', approval: 'pending Taylor' },
    ]));
    expect(r.failures).toEqual([]);
    expect(r.render()).toMatch(/listed \(pending Taylor\): \/resume\/ text: "run" → "operate"/);
  });

  it('fails a listed change that no longer occurs (the list never goes stale)', () => {
    const r = run(site(BUILT, [{ page: '/resume/', item: 'text', live: 'run', new: 'operate', why: 'test', approval: 'pending Taylor' }]));
    expect(fails(r)).toMatch(/listed but no longer occurs \(remove it\): \/resume\/ text: "run" → "operate"/);
  });

  it('fails a changed mailto subject', () => {
    const r = run(site(BUILT.replace('subject=AI Working Session', 'subject=AI Session')));
    expect(fails(r)).toMatch(/\/resume\/ link: .*\n\s+live: "Email → mailto:remundtaylor3@gmail\.com subject=AI Working Session"\n\s+new: {2}"Email → mailto:remundtaylor3@gmail\.com subject=AI Session"/);
  });

  it('fails a changed mailto address', () => {
    const r = run(site(BUILT.replace('mailto:remundtaylor3@', 'mailto:taylor@')));
    expect(fails(r)).toMatch(/\/resume\/ link:/);
  });

  it('fails a dropped § 2 anchor, and a listing cannot excuse it', () => {
    const r = run(site(BUILT.replace('id="contact"', 'id="talk"')));
    expect(fails(r)).toMatch(/\/resume\/: anchor #contact \(REWRITE\.md § 2\) is missing/);
  });

  it('fails a changed head (title, description, og:)', () => {
    const r = run(site(BUILT.replace('<meta property="og:title" content="Résumé">', '<meta property="og:title" content="CV">')));
    expect(fails(r)).toMatch(/\/resume\/ head:[\s\S]*live: "og:title: Résumé"[\s\S]*new: {2}"og:title: CV"/);
  });

  it('fails a changed alt text', () => {
    const r = run(site(BUILT.replace('alt="Taylor Remund"', 'alt="Taylor"')));
    expect(fails(r)).toMatch(/\/resume\/ alt:/);
  });

  it('fails a changed link target', () => {
    const r = run(site(BUILT.replace('href="/#patchlamp"', 'href="https://patchlamp.com"')));
    expect(fails(r)).toMatch(/\/resume\/ link:[\s\S]*live: "Patchlamp → \/#patchlamp"/);
  });

  it('lists a furniture difference once, under page "furniture"', () => {
    const r = run(site(BUILT.replace('<footer><p>Taylor Remund · 2026</p></footer>', '<footer><p>Taylor Remund · 2026</p><a href="/sms/">SMS</a></footer>')));
    expect(fails(r)).toMatch(/furniture furniture text:/);
    expect(fails(r)).toMatch(/furniture furniture link:/);
  });

  it('fails an unknown character reference instead of passing it', () => {
    const r = run(site(BUILT.replace('I build and run', 'I build &notaname; and run')));
    expect(fails(r)).toMatch(/unknown character reference &notaname;/);
  });

  it('reports a page served byte for byte from legacy/ as not migrated, not as a pass', () => {
    const r = run(site(LIVE));
    expect(r.failures).toEqual([]);
    expect(r.render()).toMatch(/NOTE {3}\/resume\/: not migrated/);
    expect(r.render()).not.toMatch(/ok {5}\/resume\//);
  });

  it('rejects a list entry with an unknown approval', () => {
    const r = run(site(BUILT, [{ page: '/resume/', item: 'text', live: 'a', new: 'b', why: 'x', approval: 'fine' as Listed['approval'] }]));
    expect(fails(r)).toMatch(/"approval" must be one of/);
  });
});

describe('check-text pieces', () => {
  it('words: phrasing tags join, every other tag separates, comments and svg are not text', () => {
    expect(words('<span>PHP</span><span>Rust</span>')).toEqual(['PHP', 'Rust']);
    expect(words('Taylor <span>Remund</span>')).toEqual(['Taylor', 'Remund']);
    expect(words('a<strong>b</strong>c <code>d</code>')).toEqual(['abc', 'd']);
    expect(words('<!-- x --> y <svg><title>t</title></svg>')).toEqual(['y']);
    expect(words('a&nbsp;b &amp; &ldquo;c&rdquo;')).toEqual(['a', 'b', '&', '“c”']);
  });

  it('regions: <main> on a new page; nav and footer on a live one', () => {
    const b = regions(BUILT);
    expect(words(b.content)).toContain('engineer\'s');
    expect(words(b.furniture)).toEqual(['Taylor', 'Remund', 'Projects', 'Taylor', 'Remund', '·', '2026']);
    const l = regions(LIVE);
    expect(words(l.furniture)).toEqual(['Taylor', 'Remund', 'Projects', 'Taylor', 'Remund', '·', '2026']);
  });

  it('regions: a page that names its furniture (the stage page `/`) keeps only those elements as furniture', () => {
    const stage = '<body><a class="skip" href="#paperwork">Skip</a><header><h1>Taylor Remund</h1></header><div id="controls"><button>Pan</button></div><main id="paperwork"><h2>The lamp</h2></main><footer><a href="/sms/">SMS</a></footer></body>';
    const r = regions(stage, ['header', 'footer']);
    expect(words(r.content)).toEqual(['The', 'lamp']);
    expect(words(r.furniture)).toEqual(['Taylor', 'Remund', 'SMS']);
    // without the list, everything outside <main> is furniture
    expect(words(regions(stage).furniture)).toEqual(['Skip', 'Taylor', 'Remund', 'Pan', 'SMS']);
  });

  it('target: relative, root-relative and absolute forms of one path are equal; mailto keeps its subject', () => {
    expect(target('../ai/', '/resume/')).toBe('/ai/');
    expect(target('/ai', '/resume/')).toBe('/ai/');
    expect(target('https://taylorremund.com/ai/index.html', '/resume/')).toBe('/ai/');
    expect(target('#projects', '/resume/')).toBe('#projects');
    expect(target('/resume/#projects', '/resume/')).toBe('#projects');
    expect(target('mailto:A@B.c?subject=Hi%20there', '/')).toBe('mailto:a@b.c subject=Hi there');
  });

  it('links: an icon link is named by its aria-label or title', () => {
    expect(links('<a href="x" title="View on GitHub"><svg></svg></a><a href="mailto:a@b" aria-label="Email"></a>', '/')).toEqual(['View on GitHub → /x/', 'Email → mailto:a@b']);
  });

  it('headItems: title, description, robots and og:', () => {
    expect([...headItems('<head><title>A &amp; B</title><meta name="robots" content="noindex, follow"><meta property="og:url" content="u"></head>')]).toEqual([
      ['og:url', 'u'], ['robots', 'noindex, follow'], ['title', 'A & B'],
    ]);
  });

  it('diff: runs of changes with context', () => {
    expect(diff(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])).toEqual([
      { live: 'b', new: 'x', before: 'a' },
      { live: '', new: 'e', before: 'a x c d' },
    ].map((h, i) => (i === 1 ? { ...h, before: 'a b c d' } : h)));
    expect(diff(['x', 'y'], ['x', 'y'])).toEqual([]);
  });

  it('formatList prints a table a person can read', () => {
    const list: Listed[] = [{ page: '/resume/', item: 'text', live: 'procedural', new: '', why: 'macro_rules!', approval: 'correction of a wrong fact, REWRITE.md § 3' }];
    expect(listProblems(list)).toEqual([]);
    const t = formatList(list);
    expect(t).toMatch(/1 , of which 0 pending Taylor|: 1, of which 0 pending Taylor/);
    expect(t).toMatch(/live: procedural\n\s+new: {2}\(nothing\)/);
  });
});
