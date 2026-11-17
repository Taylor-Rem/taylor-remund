import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { checkLinks } from '../../../scripts/check-links.ts';
import { classify, resolveToFile } from '../../../scripts/lib/urls.ts';
import { edit, makeSite, write } from './helpers.ts';

const fails = (r: { failures: string[] }): string => r.failures.join('\n');

describe('check-links', () => {
  it('passes on the minimal site (legacy pages, svg sprite fragments included) and lists externals', () => {
    const s = makeSite();
    const r = checkLinks({ dist: s.dist });
    expect(r.failures).toEqual([]);
    expect(r.render()).toMatch(/external references? to \d+ URLs? \(not fetched/);
    expect(r.render()).toContain('https://patchlamp.com/');
  });

  it('fails on a missing file', () => {
    const s = makeSite();
    edit(join(s.dist, 'index.html'), '<a href="/">Home</a>', '<a href="/">Home</a><a href="/work/">Work</a><img src="nope.png">');
    const f = fails(checkLinks({ dist: s.dist }));
    expect(f).toMatch(/^\/ → \/work\/ \(no such file\)$/m);
    expect(f).toMatch(/^\/ → nope\.png \(no such file\)$/m);
  });

  it('fails on a missing fragment, in a page or an SVG sprite', () => {
    const s = makeSite();
    edit(join(s.dist, 'index.html'), '<a href="/">Home</a>', '<a href="/resume/#hobbies">x</a><svg><use href="/assets/icons.svg#icon-nope"/></svg><a href="#nowhere">y</a>');
    const f = fails(checkLinks({ dist: s.dist }));
    expect(f).toMatch(/\/ → \/resume\/#hobbies \(no id "hobbies" in resume\/index\.html\)/);
    expect(f).toMatch(/\/ → \/assets\/icons\.svg#icon-nope \(no id "icon-nope" in assets\/icons\.svg\)/);
    expect(f).toMatch(/\/ → #nowhere \(no id "nowhere" in index\.html\)/);
  });

  it('checks srcset candidates and CSS url() relative to the stylesheet', () => {
    const s = makeSite();
    edit(join(s.dist, 'index.html'), '640w,', '640w, /assets/missing-960.webp 960w,');
    write(join(s.dist, 'styles/paper.css'), '@font-face{font-family:X;src:url(../fonts/x.woff2) format("woff2")}\nbody{background:url("img/bg.png")}');
    write(join(s.dist, 'fonts/x.woff2'), 'x');
    const f = fails(checkLinks({ dist: s.dist }));
    expect(f).toMatch(/\/ → \/assets\/missing-960\.webp/);
    expect(f).toMatch(/\/styles\/paper\.css → img\/bg\.png \(no such file\)/);
    expect(f).not.toMatch(/x\.woff2/);
  });

  it('skips mailto:, tel: and data:; does not fetch externals', () => {
    const s = makeSite();
    edit(join(s.dist, 'index.html'), '<a href="/">Home</a>', '<a href="tel:+19377644699">t</a><img src="data:image/png;base64,AAAA"><a href="https://example.com/missing">e</a>');
    expect(checkLinks({ dist: s.dist }).failures).toEqual([]);
  });

  it('fails on relative references in 404.html', () => {
    const s = makeSite();
    edit(join(s.dist, '404.html'), '<a href="/">Home</a>', '<a href="resume/">Résumé</a>');
    expect(fails(checkLinks({ dist: s.dist }))).toMatch(/\/404\.html → resume\/ \(relative reference on 404\.html/);
  });

  it('fails when dist is missing', () => {
    expect(fails(checkLinks({ dist: '/nonexistent/dist' }))).toMatch(/build output not found/);
  });
});

describe('url resolution', () => {
  it('classifies references', () => {
    expect(classify('../privacy/', '/resume/')).toEqual({ kind: 'internal', path: '/privacy/', fragment: null });
    expect(classify('https://www.taylorremund.com/ai/#faq', '/')).toEqual({ kind: 'internal', path: '/ai/', fragment: 'faq' });
    expect(classify('//fonts.gstatic.com/x', '/')).toMatchObject({ kind: 'external', host: 'fonts.gstatic.com' });
    expect(classify('MAILTO:x@y', '/')).toMatchObject({ kind: 'skip' });
  });
  it('resolves like GitHub Pages', () => {
    const s = makeSite();
    expect(resolveToFile(s.dist, '/resume')).toMatch(/resume\/index\.html$/);
    expect(resolveToFile(s.dist, '/resume/')).toMatch(/resume\/index\.html$/);
    expect(resolveToFile(s.dist, '/404')).toMatch(/404\.html$/);
    expect(resolveToFile(s.dist, '/nope/')).toBeNull();
  });
});
