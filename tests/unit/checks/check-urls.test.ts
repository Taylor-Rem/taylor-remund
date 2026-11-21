import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkUrls, mailtoHrefs, multisetMinus, priceStrings } from '../../../scripts/check-urls.ts';
import { edit, legacy, makeSite, read, write } from './helpers.ts';

const fails = (r: { failures: string[] }): string => r.failures.join('\n');

describe('check-urls', () => {
  it('passes on a minimal site that keeps every path of § 2', () => {
    const s = makeSite();
    const r = checkUrls({ dist: s.dist, root: s.root });
    expect(r.failures).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.render()).toContain('/ai/: 5 mailto: hrefs equal');
    expect(r.render()).toContain('/ai/: 13 prices equal');
  });

  it('fails when dist is missing', () => {
    const s = makeSite();
    const r = checkUrls({ dist: join(s.root, 'nope'), root: s.root });
    expect(fails(r)).toMatch(/build output not found/);
  });

  it('fails when a page or an asset does not answer', () => {
    const s = makeSite();
    rmSync(join(s.dist, 'career-send'), { recursive: true });
    rmSync(join(s.dist, 'assets/exchange-room-640.webp'));
    const r = checkUrls({ dist: s.dist, root: s.root });
    expect(fails(r)).toMatch(/\/career-send\/ does not answer/);
    expect(fails(r)).toMatch(/\/assets\/exchange-room-640\.webp does not answer/);
  });

  it('fails when dist/CNAME differs from the repository CNAME', () => {
    const s = makeSite();
    writeFileSync(join(s.dist, 'CNAME'), 'www.taylorremund.com\n');
    expect(fails(checkUrls({ dist: s.dist, root: s.root }))).toMatch(/dist\/CNAME .* not byte-identical/);
  });

  it('fails on a missing anchor', () => {
    const s = makeSite();
    edit(join(s.dist, 'index.html'), 'id="services"', 'id="offers"');
    expect(fails(checkUrls({ dist: s.dist, root: s.root }))).toMatch(/\/: required anchor #services missing/);
  });

  it.each([
    ['root-relative', '/career-send/'],
    ['no slash', '/career-send'],
    ['index.html', '/career-send/index.html'],
    ['relative', '../career-send/'],
    ['absolute with domain', 'https://taylorremund.com/career-send/'],
    ['www', 'https://www.taylorremund.com/career-send'],
  ])('fails on a link to /career-send/ (%s)', (_label, href) => {
    const s = makeSite();
    edit(join(s.dist, 'terms/index.html'), '<a href="/">Home</a>', `<a href="/">Home</a> <a href="${href}">Career Send</a>`);
    expect(fails(checkUrls({ dist: s.dist, root: s.root }))).toMatch(/\/terms\/ links \/career-send\/.*must stay unlinked/);
  });

  it('fails when a sitemap lists /career-send/ or a noindex page', () => {
    const s = makeSite();
    write(join(s.dist, 'sitemap-0.xml'), '<urlset><url><loc>https://taylorremund.com/</loc></url><url><loc>https://taylorremund.com/career-send/</loc></url><url><loc>https://taylorremund.com/privacy/</loc></url></urlset>');
    const f = fails(checkUrls({ dist: s.dist, root: s.root }));
    expect(f).toMatch(/sitemap-0\.xml lists https:\/\/taylorremund\.com\/career-send\//);
    expect(f).toMatch(/sitemap-0\.xml lists https:\/\/taylorremund\.com\/privacy\//);
  });

  it('passes a sitemap of indexable pages only', () => {
    const s = makeSite();
    write(join(s.dist, 'sitemap-0.xml'), '<urlset><url><loc>https://taylorremund.com/</loc></url><url><loc>https://taylorremund.com/sms/</loc></url></urlset>');
    expect(checkUrls({ dist: s.dist, root: s.root }).failures).toEqual([]);
  });

  it('fails when robots meta is added to /sms/', () => {
    const s = makeSite();
    edit(join(s.dist, 'sms/index.html'), '<title>SMS</title>', '<title>SMS</title><meta name="robots" content="noindex, follow">');
    expect(fails(checkUrls({ dist: s.dist, root: s.root }))).toMatch(/\/sms\/: has robots meta "noindex, follow"; as published it has none/);
  });

  it('fails when /privacy/ loses or changes its robots meta', () => {
    const s = makeSite();
    edit(join(s.dist, 'privacy/index.html'), 'content="noindex, follow"', 'content="noindex"');
    edit(join(s.dist, 'terms/index.html'), '<meta name="robots" content="noindex, follow">', '');
    const f = fails(checkUrls({ dist: s.dist, root: s.root }));
    expect(f).toMatch(/\/privacy\/: robots meta "noindex"; expected exactly one, content="noindex, follow"/);
    expect(f).toMatch(/\/terms\/: robots meta missing/);
  });

  it('fails when a footer does not link /sms/ (relative links resolve properly)', () => {
    const s = makeSite();
    edit(join(s.dist, 'privacy/index.html'), '<a href="/sms/">SMS</a>', '');
    // relative spellings count
    edit(join(s.dist, 'terms/index.html'), '<a href="/sms/">SMS</a>', '<a href="../sms">SMS</a>');
    const f = fails(checkUrls({ dist: s.dist, root: s.root }));
    expect(f).toMatch(/\/privacy\/: footer does not link \/sms\//);
    expect(f).not.toMatch(/\/terms\/: footer/);
  });

  it('fails a page with no footer, and a link outside the footer does not count', () => {
    const s = makeSite();
    const p = join(s.dist, '404.html');
    writeFileSync(p, read(p).replace(/<footer[\s\S]*<\/footer>/, '<p><a href="/privacy/">P</a><a href="/terms/">T</a><a href="/sms/">S</a></p>'));
    expect(fails(checkUrls({ dist: s.dist, root: s.root }))).toMatch(/\/404\.html: no <footer> element/);
  });

  it('fails when /sms/ loses the service number', () => {
    const s = makeSite();
    edit(join(s.dist, 'sms/index.html'), '(937) 764-4699', '(937) 764-0000');
    expect(fails(checkUrls({ dist: s.dist, root: s.root }))).toMatch(/\/sms\/ does not show the service number \(937\) 764-4699/);
  });

  it("allows the layout's bare Email link on /ai/ once, and nothing else extra", () => {
    const s = makeSite();
    edit(join(s.dist, 'ai/index.html'), '<main>', '<main><a href="mailto:remundtaylor3@gmail.com">Email</a>');
    const r = checkUrls({ dist: s.dist, root: s.root });
    expect(r.failures).toEqual([]);
    expect(r.render()).toContain("the layout's own Email link (mailto:remundtaylor3@gmail.com) is not compared");
    edit(join(s.dist, 'ai/index.html'), '<main>', '<main><a href="mailto:remundtaylor3@gmail.com">Email</a>');
    expect(fails(checkUrls({ dist: s.dist, root: s.root }))).toMatch(/\/ai\/: mailto: href in the build is not on the legacy page: mailto:remundtaylor3@gmail\.com$/m);
  });

  it('fails on a changed mailto: subject on /ai/', () => {
    const s = makeSite();
    edit(join(s.dist, 'ai/index.html'), 'subject=AI%20on%20My%20Computer', 'subject=AI%20on%20Your%20Computer');
    const f = fails(checkUrls({ dist: s.dist, root: s.root }));
    expect(f).toMatch(/\/ai\/: mailto: href on the legacy page is missing from the build: mailto:remundtaylor3@gmail\.com\?subject=AI%20on%20My%20Computer/);
    expect(f).toMatch(/\/ai\/: mailto: href in the build is not on the legacy page: .*AI%20on%20Your%20Computer/);
  });

  it('fails on a changed price on /ai/', () => {
    const s = makeSite();
    edit(join(s.dist, 'ai/index.html'), '<div class="pkg-price">$150</div>', '<div class="pkg-price">$175</div>');
    const f = fails(checkUrls({ dist: s.dist, root: s.root }));
    expect(f).toMatch(/price on the legacy page is missing from the build: \$150/);
    expect(f).toMatch(/price in the build is not on the legacy page: \$175/);
  });

  it('fails a page served byte for byte from legacy/, and the old stylesheet or script in the output', () => {
    const s = makeSite();
    expect(checkUrls({ dist: s.dist, root: s.root }).render()).toMatch(/no page of \d+ is a copy of a legacy file/);
    write(join(s.dist, 'ai/index.html'), legacy('ai/index.html'));
    write(join(s.dist, 'style.css'), legacy('style.css'));
    write(join(s.dist, 'script.js'), legacy('script.js'));
    const f = fails(checkUrls({ dist: s.dist, root: s.root }));
    expect(f).toMatch(/\/ai\/: served byte for byte from legacy\/ai\/index\.html/);
    expect(f).toMatch(/dist\/style\.css exists/);
    expect(f).toMatch(/dist\/script\.js exists/);
  });

  it('fails when a dev page is in the build', () => {
    const s = makeSite();
    write(join(s.root, 'src/dev-pages/catalogue.astro'), '---\n---\n<h1>kit</h1>');
    write(join(s.dist, 'catalogue/index.html'), '<footer></footer>');
    mkdirSync(join(s.dist, 'dev'));
    const f = fails(checkUrls({ dist: s.dist, root: s.root }));
    expect(f).toMatch(/dist\/dev exists/);
    expect(f).toMatch(/dist\/catalogue\/index\.html looks built from src\/dev-pages\/catalogue\.astro/);
  });
});

describe('check-urls helpers', () => {
  it('reads mailto: hrefs with entities decoded', () => {
    expect(mailtoHrefs('<a href="mailto:a@b.c?subject=A&amp;B">x</a><a href="/x">y</a>')).toEqual(['mailto:a@b.c?subject=A&B']);
  });
  it('finds prices in text and meta description', () => {
    const html = '<meta name="description" content="from $150"><p>$500&ndash;$1,500 &middot; care $79/mo, <strong>$25</strong>/mo</p>';
    expect(priceStrings(html)).toEqual(['$1,500', '$150', '$25/mo', '$500', '$79/mo'].sort());
  });
  it('derives the legacy /ai/ prices by pattern', () => {
    expect(priceStrings(legacy('ai/index.html').toString('utf8'))).toEqual(
      ['$1,500', '$1,500', '$150', '$150', '$150', '$150', '$25', '$25/mo', '$250', '$500', '$500', '$79', '$79/mo'],
    );
  });
  it('multiset difference counts duplicates', () => {
    expect(multisetMinus(['a', 'a', 'b'], ['a', 'b'])).toEqual(['a']);
  });
});
