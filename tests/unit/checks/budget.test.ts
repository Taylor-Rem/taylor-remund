import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { checkBudget } from '../../../scripts/budget.ts';
import { edit, legacy, makeSite, write } from './helpers.ts';

const fails = (r: { failures: string[] }): string => r.failures.join('\n');

describe('budget', () => {
  it('passes the minimal site, printing the measured numbers, with no page exempt', () => {
    const s = makeSite();
    const r = checkBudget({ dist: s.dist });
    expect(r.failures).toEqual([]);
    const out = r.render();
    expect(out).toMatch(/gzip -9/);
    expect(out).toMatch(/ok {5}first paint of \/ .*: \d+(\.\d)? KB of 200\.0 KB/);
    expect(out).toMatch(/ok {5}\/resume\/: no third-party request/);
    expect(out).toMatch(/ok {5}\/ai\/: no third-party request/);
    expect(out).not.toMatch(/EXEMPT/);
    expect(out).toMatch(/ok {5}\/privacy\/: no third-party request/);
    expect(out).toMatch(/sound: no dist\/sounds\//);
  });

  it('the old hand-written /ai/ would fail on Google Fonts: no page is exempt', () => {
    const s = makeSite();
    write(join(s.dist, 'ai/index.html'), legacy('ai/index.html'));
    const f = fails(checkBudget({ dist: s.dist }));
    expect(f).toMatch(/\/ai\/: third-party request: link\[rel=stylesheet\] https:\/\/fonts\.googleapis\.com/);
    expect(f).toMatch(/\/ai\/: third-party request: link\[rel=preconnect\] https:\/\/fonts\.gstatic\.com/);
  });

  it('fails a third-party font URL on a conventional page, through its stylesheet', () => {
    const s = makeSite();
    write(join(s.dist, 'styles/paper.css'), '@font-face{font-family:Inter;src:url(https://fonts.gstatic.com/s/inter/v1/x.woff2) format("woff2")}');
    const f = fails(checkBudget({ dist: s.dist }));
    expect(f).toMatch(/\/terms\/: third-party request: styles\/paper\.css url\(\) https:\/\/fonts\.gstatic\.com\/s\/inter\/v1\/x\.woff2/);
    expect(f).toMatch(/^\/: third-party request/m); // / shares the stylesheet
  });

  it('fails a third-party stylesheet, @import, script or iframe; a plain link to another site is fine', () => {
    const s = makeSite();
    edit(join(s.dist, 'sms/index.html'), '</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>@import url("https://cdn.example.com/a.css");</style><script src="https://cdn.example.com/x.js"></script></head>');
    edit(join(s.dist, 'terms/index.html'), '<main>', '<main><a href="https://patchlamp.com/terms">Patchlamp</a><iframe src="https://www.youtube.com/embed/x"></iframe>');
    const f = fails(checkBudget({ dist: s.dist }));
    expect(f).toMatch(/\/sms\/: third-party request: link\[rel=stylesheet\] https:\/\/fonts\.googleapis\.com/);
    expect(f).toMatch(/\/sms\/: third-party request: style @import https:\/\/cdn\.example\.com\/a\.css/);
    expect(f).toMatch(/\/sms\/: third-party request: script\[src\] https:\/\/cdn\.example\.com\/x\.js/);
    expect(f).toMatch(/\/terms\/: third-party request: iframe\[src\] https:\/\/www\.youtube\.com/);
    expect(f).not.toMatch(/patchlamp\.com\/terms/);
  });

  it('fails a conventional page carrying more than 5 KB of JavaScript (inline + referenced + imported)', () => {
    const s = makeSite();
    write(join(s.dist, '_astro/dep.js'), `export const x = "${'a'.repeat(4000)}";`);
    write(join(s.dist, '_astro/page.js'), `import { x } from "./dep.js"; console.log(x);`);
    edit(join(s.dist, 'privacy/index.html'), '</head>', `<script type="module" src="/_astro/page.js"></script><script>${'/*pad*/'.repeat(200)}</script><script type="application/ld+json">${'{}'.repeat(5000)}</script></head>`);
    const f = fails(checkBudget({ dist: s.dist }));
    expect(f).toMatch(/\/privacy\/: JavaScript \(raw, inline \+ referenced \+ imported\): 5\.\d KB of 5\.0 KB — over budget/);
  });

  it('fails when first paint of / is over 200 KB', () => {
    const s = makeSite();
    write(join(s.dist, 'assets/hero.jpg'), randomBytes(150_000));
    edit(join(s.dist, 'index.html'), '<main>', '<main><img src="/assets/hero.jpg" alt="">');
    expect(fails(checkBudget({ dist: s.dist }))).toMatch(/first paint of \/ .*of 200\.0 KB — over budget/);
  });

  it('counts the largest candidate of a picture, not all of them', () => {
    const s = makeSite();
    // 640w + 1280w webp + 1280 jpg are ~317 KB together; only the jpg (132 KB) counts.
    expect(checkBudget({ dist: s.dist }).failures).toEqual([]);
  });

  it('fails when stage scripts exceed 2.2 MB compressed', () => {
    const s = makeSite();
    write(join(s.dist, '_astro/rapier.wasm'), randomBytes(1_500_000));
    write(join(s.dist, '_astro/three.js'), randomBytes(800_000).toString('base64'));
    expect(fails(checkBudget({ dist: s.dist }))).toMatch(/stage transfer \(\d+ script\/wasm files.*of 2\.20 MB — over budget/);
  });

  it('a stage page in the build: everything it fetches, the wasm, a worker and the bake table named in strings, the fonts by name, each once', () => {
    const s = makeSite();
    // no stage page: no row (a normal build's verify is unchanged)
    expect(checkBudget({ dist: s.dist }).render()).not.toMatch(/stage page/);
    write(join(s.dist, 'dev/bench/index.html'), '<!doctype html><title>b</title><script type="module" src="/_astro/page.js"></script>');
    write(join(s.dist, '_astro/page.js'), 'import "./boot.js"; const go = () => import("./lazy.js");');
    write(join(s.dist, '_astro/boot.js'), 'const w = new Worker(new URL(`/_astro/worker.js`, import.meta.url)); const t = `/_astro/table.bin`;');
    write(join(s.dist, '_astro/lazy.js'), 'export const wasm = "/_astro/phys.wasm"; export const f = { file: `face.woff2` };');
    write(join(s.dist, '_astro/worker.js'), 'import "./boot.js";');
    write(join(s.dist, '_astro/phys.wasm'), randomBytes(1_000));
    write(join(s.dist, '_astro/table.bin'), randomBytes(2_000));
    write(join(s.dist, 'fonts/face.woff2'), randomBytes(3_000));
    write(join(s.dist, '_astro/unused.js'), 'export const nobody = 1;');
    const out = checkBudget({ dist: s.dist, stagePages: ['/dev/bench/'] }).render();
    expect(out).toMatch(/ok {5}stage page \/dev\/bench\/: to usable, everything it fetches up to the bench taking input \(8 files/);
    // (E1) nothing late: the second row is the first again
    expect(out).toMatch(/ok {5}stage page \/dev\/bench\/: to usable \+ after, .*\(0 late files, 0 B;/);
    const r2 = checkBudget({ dist: s.dist, stagePages: ['/dev/bench/'] });
    expect(r2.failures).toEqual([]);
    write(join(s.dist, '_astro/table.bin'), randomBytes(2_300_000));
    expect(fails(checkBudget({ dist: s.dist, stagePages: ['/dev/bench/'] }))).toMatch(/stage page \/dev\/bench\/: to usable.*of 2\.20 MB — over budget/);
  });

  it('(E1) a late unit: its chunk is "after", reached by a dynamic import or a preload list, never "to usable"; reached eagerly, it fails', () => {
    const s = makeSite();
    write(join(s.dist, 'dev/bench/index.html'), '<!doctype html><title>b</title><script type="module" src="/_astro/page.js"></script>');
    // the page: the bench, and the late loader's way to him (a facade that imports his chunk, as the build makes it; the
    // preload list names his chunk too)
    write(join(s.dist, '_astro/page.js'), 'import "./bench.js"; const deps = ["_astro/late-pitch.js", "_astro/bench.js"]; const go = () => import("./pitch.js");');
    write(join(s.dist, '_astro/bench.js'), `export const b = "${randomBytes(1_000).toString('base64')}";`);
    write(join(s.dist, '_astro/pitch.js'), 'export { p } from "./late-pitch.js";');
    // his chunk imports the bench's (already fetched: not counted again) and fetches a table of his own
    write(join(s.dist, '_astro/late-pitch.js'), `import { b } from "./bench.js"; export const p = "${randomBytes(30_000).toString('base64')}"; const t = "/_astro/his.bin";`);
    write(join(s.dist, '_astro/his.bin'), randomBytes(5_000));
    const r = checkBudget({ dist: s.dist, stagePages: ['/dev/bench/'] });
    // (a dev page here also carries the conventional pages' 5 KB row, which its scripts are over: not this test's)
    expect(r.failures.filter((f) => /stage page/.test(f))).toEqual([]);
    const out = r.render();
    // to usable: the page and the bench's script (2 files), not his
    expect(out).toMatch(/ok {5}stage page \/dev\/bench\/: to usable, .*\(3 files/);
    expect(out).toMatch(/late-pitch\.js \(after\)/);
    expect(out).toMatch(/his\.bin \(after\)/);
    expect(out).toMatch(/pitch\.js \(after\)/);
    expect(out).toMatch(/ok {5}stage page \/dev\/bench\/: to usable \+ after, .*\(3 late files/);
    // after over its own cap: to usable is fine, the second row fails
    write(join(s.dist, '_astro/his.bin'), randomBytes(2_700_000));
    const f2 = fails(checkBudget({ dist: s.dist, stagePages: ['/dev/bench/'] }));
    expect(f2).toMatch(/to usable \+ after.*of 2\.60 MB — over budget/);
    expect(f2).not.toMatch(/to usable, /);
    write(join(s.dist, '_astro/his.bin'), randomBytes(5_000));
    // folded back into what loads first: the bench imports him statically
    write(join(s.dist, '_astro/bench.js'), 'import "./pitch.js"; export const b = 1;');
    expect(fails(checkBudget({ dist: s.dist, stagePages: ['/dev/bench/'] }))).toMatch(/late-pitch\.js is a late chunk, but the page reaches it eagerly/);
    // or preloaded by the page itself
    write(join(s.dist, '_astro/bench.js'), 'export const b = 1;');
    write(join(s.dist, 'dev/bench/index.html'), '<!doctype html><title>b</title><link rel="modulepreload" href="/_astro/late-pitch.js"><script type="module" src="/_astro/page.js"></script>');
    expect(fails(checkBudget({ dist: s.dist, stagePages: ['/dev/bench/'] }))).toMatch(/late-pitch\.js is a late chunk, but the page reaches it eagerly/);
  });

  it('fails when sound exceeds 400 KB', () => {
    const s = makeSite();
    write(join(s.dist, 'sounds/a.ogg'), randomBytes(250_000));
    write(join(s.dist, 'sounds/b.ogg'), randomBytes(200_000));
    expect(fails(checkBudget({ dist: s.dist }))).toMatch(/sound \(2 files under dist\/sounds\/, raw\): 450\.0 KB of 400\.0 KB — over budget/);
  });

  it('fails when dist or / is missing', () => {
    expect(fails(checkBudget({ dist: '/nonexistent/dist' }))).toMatch(/build output not found/);
  });
});
