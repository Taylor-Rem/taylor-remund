// check-legal: the compliance pages change only on purpose (REWRITE.md § 2, § E8 "Legal").
//
// Check 1: each compliance page has exactly one `<div class="container legal">`
//   element, and its bytes equal legal-reference/<page>.html.
// Check 2: every `legal-callout` block in the build equals the copy frozen from
//   main at fa99b13. The frozen hashes are constants in scripts/site.ts, so no
//   edit to legal-reference/ can satisfy this check.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { excerpt, isDir, isFile, sha256, walk } from './lib/fsutil.ts';
import { classList, findElements, scanTags } from './lib/html.ts';
import { urlPathForFile } from './lib/urls.ts';
import { gitHasCommit, gitShow } from './lib/legacy.ts';
import { CALLOUT_SHA256, LEGACY_COMMIT, LEGAL_WRAPPER_OPEN, PAGES, compliancePages, slug } from './site.ts';

export interface LegalOptions {
  dist: string;
  root: string;
  /** Defaults to <root>/legal-reference. */
  refDir?: string;
  /** Whether to compare with `git show fa99b13:` when the commit exists (default true). */
  useGit?: boolean;
}

export interface Span {
  start: number;
  end: number;
  openText: string;
}

/** The byte spans of every element whose open tag is exactly LEGAL_WRAPPER_OPEN, and of other elements with class `legal`. */
export function legalWrappers(bytes: Buffer): { exact: Span[]; others: Span[] } {
  const s = bytes.toString('latin1');
  const tags = scanTags(s);
  const exact: Span[] = [];
  const others: Span[] = [];
  for (const e of findElements(s, (t) => t.name === 'div' || classList(t).includes('legal'), tags)) {
    if (e.openText === LEGAL_WRAPPER_OPEN) exact.push(e);
    else if (classList(e.tag).includes('legal')) others.push(e);
  }
  return { exact, others };
}

/** The byte spans of every element with class `legal-callout`, in document order. */
export function calloutSpans(bytes: Buffer): Span[] {
  const s = bytes.toString('latin1');
  return findElements(s, (t) => classList(t).includes('legal-callout'));
}

export function firstDiff(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** A message naming the first differing byte with ~60 bytes of context from each side. */
export function describeDiff(label: string, got: Buffer, want: Buffer, gotName: string, wantName: string): string {
  const at = firstDiff(got, want);
  const g = got.toString('latin1');
  const w = want.toString('latin1');
  return [
    `${label}: first differing byte at offset ${at} (${gotName} ${got.length} bytes, ${wantName} ${want.length} bytes)`,
    `         ${gotName.padEnd(10)} ${excerpt(g, at)}`,
    `         ${wantName.padEnd(10)} ${excerpt(w, at)}`,
  ].join('\n');
}

function slice(bytes: Buffer, sp: Span): Buffer {
  return bytes.subarray(sp.start, sp.end);
}

export function checkWrappers(r: Report, dist: string, refDir: string): void {
  for (const p of compliancePages()) {
    const name = slug(p);
    const builtPath = join(dist, p.file);
    const refPath = join(refDir, `${name}.html`);
    if (!isFile(builtPath)) {
      r.fail(`[1] ${p.path}: built page ${p.file} missing`);
      continue;
    }
    if (!isFile(refPath)) {
      r.fail(`[1] ${p.path}: reference legal-reference/${name}.html missing`);
      continue;
    }
    const built = readFileSync(builtPath);
    const ref = readFileSync(refPath);
    const { exact, others } = legalWrappers(built);
    for (const o of others) r.fail(`[1] ${p.path}: another element with class "legal" (${JSON.stringify(o.openText)}); only ${LEGAL_WRAPPER_OPEN} is allowed`);
    if (exact.length !== 1) {
      r.fail(`[1] ${p.path}: ${exact.length} elements open with ${LEGAL_WRAPPER_OPEN}; expected exactly 1`);
      continue;
    }
    const sp = exact[0];
    if (sp.end < 0) {
      r.fail(`[1] ${p.path}: ${LEGAL_WRAPPER_OPEN} is never closed`);
      continue;
    }
    const got = slice(built, sp);
    if (got.equals(ref)) r.ok(`[1] ${p.path}: .legal wrapper equals legal-reference/${name}.html (${ref.length} bytes, sha256 ${sha256(ref).slice(0, 12)}…)`);
    else r.fail(describeDiff(`[1] ${p.path}: .legal wrapper differs from legal-reference/${name}.html`, got, ref, 'built', 'reference'));
  }
}

export function checkCallouts(r: Report, dist: string, refDir: string, root: string, useGit: boolean): void {
  // The frozen bytes, for context in messages and the byte comparison.
  const frozen = new Map<string, Buffer[]>();

  // (a) legal-reference/callouts/ still hashes to the constants.
  const calloutDir = join(refDir, 'callouts');
  const expectedFiles = new Set<string>();
  for (const [name, hashes] of Object.entries(CALLOUT_SHA256)) {
    hashes.forEach((h, i) => {
      const file = `${name}-${i + 1}.html`;
      expectedFiles.add(file);
      const path = join(calloutDir, file);
      if (!isFile(path)) {
        r.fail(`[2] legal-reference/callouts/${file} missing`);
        return;
      }
      const got = sha256(readFileSync(path));
      if (got !== h) r.fail(`[2] legal-reference/callouts/${file} was edited: sha256 ${got}, frozen ${h}`);
      else r.ok(`[2] legal-reference/callouts/${file} matches the frozen hash`);
    });
  }
  if (isDir(calloutDir)) {
    for (const f of readdirSync(calloutDir)) {
      if (!expectedFiles.has(f)) r.fail(`[2] legal-reference/callouts/${f} is not one of the frozen callouts`);
    }
  }

  // (b) the git extraction from main at fa99b13, when the commit is here.
  if (!useGit) {
    r.note(`[2] comparison with git ${LEGACY_COMMIT} skipped (disabled)`);
  } else if (!gitHasCommit(root)) {
    r.note(`[2] commit ${LEGACY_COMMIT} not available (shallow clone?); comparison with git skipped, hashes still enforced`);
  } else {
    for (const p of compliancePages()) {
      const name = slug(p);
      const page = gitShow(root, p.file);
      if (!page) {
        r.fail(`[2] git show ${LEGACY_COMMIT}:${p.file} failed`);
        continue;
      }
      const spans = calloutSpans(page);
      const blocks = spans.map((sp) => slice(page, sp));
      const want = CALLOUT_SHA256[name] ?? [];
      const hashes = blocks.map((b) => sha256(b));
      if (hashes.length !== want.length || hashes.some((h, i) => h !== want[i])) {
        r.fail(`[2] callouts extracted from ${LEGACY_COMMIT}:${p.file} do not match the embedded hashes (extractor or constants wrong)`);
      } else {
        frozen.set(name, blocks);
      }
    }
    if (frozen.size === compliancePages().length) r.ok(`[2] callouts extracted from ${LEGACY_COMMIT} match the embedded hashes`);
  }

  // Context source when git is not available: the reference copy, only if it is intact.
  const frozenBlock = (name: string, i: number): { bytes: Buffer; from: string } | null => {
    const g = frozen.get(name)?.[i];
    if (g) return { bytes: g, from: `${LEGACY_COMMIT}` };
    const path = join(calloutDir, `${name}-${i + 1}.html`);
    if (isFile(path)) {
      const b = readFileSync(path);
      if (sha256(b) === CALLOUT_SHA256[name]?.[i]) return { bytes: b, from: 'reference' };
    }
    return null;
  };

  // (c) every callout in every built page.
  const htmlFiles = walk(dist).filter((f) => f.endsWith('.html'));
  for (const p of compliancePages()) {
    if (!htmlFiles.includes(p.file)) r.fail(`[2] ${p.path}: built page ${p.file} missing; its callouts cannot be checked`);
  }
  let checked = 0;
  for (const rel of htmlFiles) {
    const urlPath = urlPathForFile(rel);
    const spec = PAGES.find((p) => p.file === rel);
    const name = spec && spec.compliance ? slug(spec) : null;
    const want = name ? CALLOUT_SHA256[name] ?? [] : [];
    const bytes = readFileSync(join(dist, rel));
    const spans = calloutSpans(bytes);
    if (spans.length !== want.length) {
      r.fail(`[2] ${urlPath}: ${spans.length} legal-callout block${spans.length === 1 ? '' : 's'}; expected ${want.length}`);
    }
    spans.forEach((sp, i) => {
      checked++;
      if (sp.end < 0) {
        r.fail(`[2] ${urlPath}: legal-callout #${i + 1} is never closed`);
        return;
      }
      const got = slice(bytes, sp);
      const h = sha256(got);
      if (i >= want.length) return; // already reported by the count
      const fb = name ? frozenBlock(name, i) : null;
      if (h !== want[i]) {
        if (fb) r.fail(describeDiff(`[2] ${urlPath}: legal-callout #${i + 1} differs from the frozen copy`, got, fb.bytes, 'built', fb.from));
        else r.fail(`[2] ${urlPath}: legal-callout #${i + 1} sha256 ${h}, frozen ${want[i]} (no intact copy available for a byte diff)`);
      } else if (fb && fb.from === LEGACY_COMMIT && !got.equals(fb.bytes)) {
        r.fail(describeDiff(`[2] ${urlPath}: legal-callout #${i + 1} differs from ${LEGACY_COMMIT}`, got, fb.bytes, 'built', fb.from));
      } else {
        r.ok(`[2] ${urlPath}: legal-callout #${i + 1} equals the frozen copy`);
      }
    });
  }
  r.info(`       [2] ${checked} legal-callout block${checked === 1 ? '' : 's'} checked in ${htmlFiles.length} page${htmlFiles.length === 1 ? '' : 's'}`);
}

export function checkLegal(opts: LegalOptions): Report {
  const r = new Report('check-legal');
  if (!isDir(opts.dist)) {
    r.fail(`build output not found: ${opts.dist} (run the build first)`);
    return r;
  }
  const refDir = opts.refDir ?? join(opts.root, 'legal-reference');
  if (!isDir(refDir)) r.fail(`legal-reference/ not found at ${refDir}`);
  checkWrappers(r, opts.dist, refDir);
  checkCallouts(r, opts.dist, refDir, opts.root, opts.useGit ?? true);
  return r;
}

runCli(import.meta.url, {
  name: 'check-legal',
  summary: 'The compliance pages: each .legal wrapper equals legal-reference/ byte for byte, and every legal-callout equals the copy frozen from main at fa99b13.',
  usesDist: true,
}, (o) => checkLegal({ dist: o.dist, root: o.root }));
