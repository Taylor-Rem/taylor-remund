import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calloutSpans, checkLegal, describeDiff, firstDiff, legalWrappers } from '../../../scripts/check-legal.ts';
import { CALLOUT_SHA256 } from '../../../scripts/site.ts';
import { sha256 } from '../../../scripts/lib/fsutil.ts';
import { REPO, edit, legacy, makeSite, must, tmp } from './helpers.ts';

const fails = (r: { failures: string[] }): string => r.failures.join('\n');

/** The real published pages at fa99b13, arranged as a dist/. */
function genuineDist(): string {
  const d = tmp('genuine-');
  execFileSync('sh', ['-c', `git -C "${REPO}" archive fa99b13 | tar -x -C "${d}"`]);
  return d;
}

/** Flip one byte inside the n-th callout of a page file; returns the absolute offset changed. */
function flipCalloutByte(file: string, delta = 40): number {
  const b = readFileSync(file);
  const sp = must(calloutSpans(b)[0], 'callout');
  const at = sp.start + delta;
  b[at] = b[at] === 0x61 ? 0x62 : 0x61; // 'a' <-> 'b'
  writeFileSync(file, b);
  return at;
}

describe('check-legal', () => {
  it('passes on the genuine published pages (git archive fa99b13 as a dist), including the git comparison', () => {
    const dist = genuineDist();
    const r = checkLegal({ dist, root: REPO });
    expect(r.failures).toEqual([]);
    const out = r.render();
    expect(out).toContain('[1] /privacy/: .legal wrapper equals legal-reference/privacy.html');
    expect(out).toContain('[1] /career-send/: .legal wrapper equals legal-reference/career-send.html');
    expect(out).toContain('callouts extracted from fa99b13 match the embedded hashes');
    expect(out).toContain('[2] /terms/: legal-callout #1 equals the frozen copy');
    expect(out).not.toContain('NOTE');
  });

  it('passes on a rebuilt site that serves the reference wrappers in new page furniture', () => {
    const s = makeSite();
    const r = checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir });
    expect(r.failures).toEqual([]);
  });

  it('the embedded hashes are the hashes of legal-reference/callouts/ today', () => {
    for (const [name, hashes] of Object.entries(CALLOUT_SHA256)) {
      hashes.forEach((h, i) => expect(sha256(readFileSync(join(REPO, 'legal-reference/callouts', `${name}-${i + 1}.html`)))).toBe(h));
    }
  });

  it('a single byte changed inside a callout fails both checks, naming the offset', () => {
    const s = makeSite();
    flipCalloutByte(join(s.dist, 'terms/index.html'));
    const r = checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir });
    const f = fails(r);
    expect(f).toMatch(/\[1\] \/terms\/: \.legal wrapper differs from legal-reference\/terms\.html: first differing byte at offset \d+/);
    expect(f).toMatch(/\[2\] \/terms\/: legal-callout #1 differs from the frozen copy: first differing byte at offset 40 /);
    expect(f).toMatch(/built {6}".*"\n.*fa99b13 {4}"/);
  });

  it('a callout edited in the built page AND in legal-reference/ (wrapper and callout copy) still fails check 2', () => {
    const s = makeSite();
    const page = join(s.dist, 'privacy/index.html');
    const old = '<div class="legal-callout">';
    // Edit the callout text in the page, then make legal-reference agree with it.
    const pageText = readFileSync(page, 'latin1');
    const sp = must(calloutSpans(Buffer.from(pageText, 'latin1'))[0], 'callout');
    const calloutOld = pageText.slice(sp.start, sp.end);
    const calloutNew = calloutOld.replace(/<p>/, '<p>We may share your number with partners. ');
    expect(calloutNew).not.toBe(calloutOld);
    writeFileSync(page, pageText.replace(calloutOld, calloutNew), 'latin1');
    const refWrap = join(s.refDir, 'privacy.html');
    writeFileSync(refWrap, readFileSync(refWrap, 'latin1').replace(calloutOld, calloutNew), 'latin1');
    writeFileSync(join(s.refDir, 'callouts/privacy-1.html'), calloutNew, 'latin1');
    expect(calloutOld.startsWith(old)).toBe(true);

    const r = checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir });
    const f = fails(r);
    expect(f).not.toMatch(/\[1\]/); // the wrapper check is satisfied by the (unapproved) reference edit…
    expect(f).toMatch(/\[2\] legal-reference\/callouts\/privacy-1\.html was edited/);
    expect(f).toMatch(/\[2\] \/privacy\/: legal-callout #1 differs from the frozen copy/); // …the callout check is not

    // Without git (a shallow clone) the embedded hashes still catch it.
    const r2 = checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir, useGit: false });
    expect(fails(r2)).toMatch(/\[2\] \/privacy\/: legal-callout #1 sha256 [0-9a-f]{64}, frozen 7c21474d/);
    expect(r2.render()).toMatch(/NOTE .*comparison with git fa99b13 skipped/);
  });

  it('notes, does not fail, when the commit is unavailable', () => {
    const s = makeSite();
    const r = checkLegal({ dist: s.dist, root: s.root, refDir: s.refDir }); // s.root is not a git repository
    expect(r.failures).toEqual([]);
    expect(r.render()).toMatch(/NOTE .*commit fa99b13 not available/);
  });

  it('a change outside the callouts fails check 1 only', () => {
    const s = makeSite();
    edit(join(s.dist, 'sms/index.html'), 'Text-Message Website Updates', 'Text-Message Website Changes');
    const f = fails(checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir }));
    expect(f).toMatch(/\[1\] \/sms\/: \.legal wrapper differs/);
    expect(f).not.toMatch(/\[2\]/);
  });

  it('fails on a second wrapper, a variant wrapper, or none', () => {
    const s = makeSite();
    edit(join(s.dist, 'terms/index.html'), '<main>', '<main><div class="container legal"></div>');
    edit(join(s.dist, 'privacy/index.html'), '<main>', '<main><div class="legal container"></div>');
    const sms = join(s.dist, 'sms/index.html');
    writeFileSync(sms, readFileSync(sms, 'latin1').replace('<div class="container legal">', '<div class="container  legal">'), 'latin1');
    const f = fails(checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir }));
    expect(f).toMatch(/\[1\] \/terms\/: 2 elements open with <div class="container legal">; expected exactly 1/);
    expect(f).toMatch(/\[1\] \/privacy\/: another element with class "legal"/);
    expect(f).toMatch(/\[1\] \/sms\/: 0 elements open with/);
  });

  it('fails when a compliance page is missing, or a callout appears on another page', () => {
    const s = makeSite();
    rmSync(join(s.dist, 'career-send'), { recursive: true });
    edit(join(s.dist, 'index.html'), '<main>', `<main>${readFileSync(join(s.refDir, 'callouts/sms-1.html'), 'utf8')}`);
    const f = fails(checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir }));
    expect(f).toMatch(/\[1\] \/career-send\/: built page career-send\/index\.html missing/);
    expect(f).toMatch(/\[2\] \/: 1 legal-callout block; expected 0/);
  });

  it('fails when a callout is removed from its page', () => {
    const s = makeSite();
    const p = join(s.dist, 'sms/index.html');
    writeFileSync(p, readFileSync(p, 'latin1').replace('class="legal-callout"', 'class="legal-note"'), 'latin1');
    expect(fails(checkLegal({ dist: s.dist, root: REPO, refDir: s.refDir }))).toMatch(/\[2\] \/sms\/: 0 legal-callout blocks; expected 1/);
  });

  it('fails when dist is missing', () => {
    expect(fails(checkLegal({ dist: '/nonexistent/dist', root: REPO }))).toMatch(/build output not found/);
  });
});

describe('check-legal extraction', () => {
  it('extracts the published wrapper and callout bytes exactly', () => {
    const page = legacy('privacy/index.html');
    const w = legalWrappers(page);
    expect(w.exact).toHaveLength(1);
    const w0 = must(w.exact[0], 'wrapper');
    expect(page.subarray(w0.start, w0.end).equals(readFileSync(join(REPO, 'legal-reference/privacy.html')))).toBe(true);
    const c = calloutSpans(page);
    expect(c).toHaveLength(1);
    const c0 = must(c[0], 'callout');
    expect(sha256(page.subarray(c0.start, c0.end))).toBe(must(CALLOUT_SHA256.privacy?.[0], 'privacy hash'));
  });

  it('matches nested divs and ignores a </div> inside a comment', () => {
    const b = Buffer.from('<div class="container legal"><div><!-- </div> --></div><p>x</p></div><div>after</div>', 'latin1');
    const w = legalWrappers(b);
    const w0 = must(w.exact[0], 'wrapper');
    expect(b.subarray(w0.start, w0.end).toString()).toBe('<div class="container legal"><div><!-- </div> --></div><p>x</p></div>');
  });

  it('firstDiff and describeDiff report the offset and context', () => {
    const a = Buffer.from('abcdef');
    const b = Buffer.from('abcXef');
    expect(firstDiff(a, b)).toBe(3);
    expect(firstDiff(a, Buffer.from('abc'))).toBe(3);
    expect(firstDiff(a, Buffer.from('abcdef'))).toBe(-1);
    expect(describeDiff('x', a, b, 'built', 'ref')).toMatch(/offset 3/);
  });
});
