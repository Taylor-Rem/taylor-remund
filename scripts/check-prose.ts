// check-prose: REWRITE.md § E4 invariant 5, "no visible sentence is written in sim, view or ui. A check fails
// the build on a string that reads like prose outside content". Every word a visitor can read lives in
// src/content/*.json; code speaks in content ids.
//
// What it reads:
//   - src/workshop/** (.ts, .js, and the code of .astro files): every string literal and template text;
//   - src/layouts/**, src/pages/**, src/components/** (.astro): the text between tags, and the values of the
//     attributes a visitor reads (alt, title, aria-label, aria-description, placeholder, label, and a
//     component's title/description props), plus the string literals of their frontmatter and scripts.
//   src/dev-pages/** (review scaffolding, never in a normal build) and tests are out of scope.
//
// What is prose (`prose()`): words of letters, at least two of them, with nothing in the string that only
// code has (=, {, <, _, /, #, $, a dotted or camelCase id, a number with a unit). And any text at all written
// straight into what a visitor sees: an .astro text node, a visible attribute's literal value, a literal
// assigned to textContent / innerText / innerHTML / title / placeholder / ariaLabel, or
// setAttribute('aria-label' | 'title' | 'alt' | 'placeholder' …, literal).
//
// What is not prose, by rule (never by a list of strings):
//   - an argument of an error, a log or an assertion: new Error / TypeError / … (…), console.*(…), assert(…);
//   - an argument of a DOM or browser call that takes code: matchMedia, querySelector, closest, createElement,
//     classList.*, addEventListener, getContext, getExtension, setProperty;
//   - an import or export specifier; an object key ('M blue': …);
//   - a developer's value by its key or property: `note:` (the parts catalogue), `error`/`reason`/`why`,
//     font names (`family:`, `from:`), and everything inside a kit piece's `variants: {…}` (catalogue options);
//   - a problem report, the template form `${subject}: what is wrong`;
//   - by shape: shader source (GLSL), CSS (declarations, selectors, a media query), a class list
//     ('ph-side ph-side-a').
// What remains and is still not a visitor's goes in ALLOW below, with its reason beside it.
// Text that is genuinely visible and in the wrong place is a FAIL to fix by moving the words to content.

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { tokenize, codeOf } from './lib/jstok.ts';
import type { Token } from './lib/jstok.ts';
import { walk } from './lib/fsutil.ts';

export const CODE_DIRS: readonly string[] = ['src/workshop'];
export const MARKUP_DIRS: readonly string[] = ['src/layouts', 'src/pages', 'src/components'];

/** Attributes whose value a visitor reads (or hears): any letters at all in a literal value is a leak. */
export const VISIBLE_ATTRS = new Set(['alt', 'title', 'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'placeholder', 'label', 'description']);
/** DOM properties a literal must not be assigned to. */
const VISIBLE_PROPS = new Set(['textContent', 'innerText', 'innerHTML', 'title', 'placeholder', 'ariaLabel', 'ariaDescription', 'ariaValueText', 'alt', 'label']);
/** Calls whose string arguments are for developers: errors, logs, assertions. */
const DEV_CALLS = /^(Error|TypeError|RangeError|SyntaxError|ReferenceError|AggregateError|DOMException|\w+Error|console\.\w+|assert(\.\w+)?|fail|warnOnce|debug|measure|mark|performance\.\w+)$/;
/** Calls whose string arguments are code: media queries, selectors, tag names, class names, event names. */
const CODE_CALLS = /(^|\.)(matchMedia|querySelector|querySelectorAll|closest|matches|getElementById|createElement|createElementNS|addEventListener|removeEventListener|getContext|getExtension|setProperty|getPropertyValue|removeProperty|add|remove|toggle|contains|replace)$/;
/** Object keys whose string values are for developers. */
const DEV_KEYS = /^(note|error|reason|why|family|from|fontFamily|answers)$/;
/** Object keys whose whole value (everything inside the braces) is for developers: a kit piece's catalogue options. */
const DEV_BLOCKS = new Set(['variants']);

/**
 * Allowed by hand, each with its reason: `path` and a substring of the literal. Keep this short: a pattern that
 * recurs is a rule above, not a run of entries here.
 */
export const ALLOW: readonly { path: string; match: RegExp; reason: string }[] = [
  { path: 'src/workshop/sim/instruct/words.ts', match: /[\s\S]/, reason: "the instruction parser's vocabulary: phrases a visitor may type, matched against the text, never shown" },
  { path: 'src/workshop/sim/registry.ts', match: /^an interactable has no id$/, reason: 'registryProblems() report line, read by tests and the console' },
  { path: 'src/workshop/view/labels/pool.ts', match: /^worker error$/, reason: "the label worker pool's internal reason for killing a worker (logged, never shown)" },
  { path: 'src/workshop/view/kit/compose.ts', match: /^(draw calls: | cast a shadow\)|; per-node backend would be |by material: |by node: )$/, reason: "a piece's triangle and draw-call report for the parts catalogue (dev page) and the console" },
  { path: 'src/workshop/sim/instruct/tape.ts', match: /[\s\S]/, reason: "the label tape's filter: word lists in ROT13 and the sign's own words, compared against what a visitor types, never shown" },
  { path: 'src/workshop/audio/audition.ts', match: /[\s\S]/, reason: "the sound audition's scene names (a developer's listening tool, written to WAV file names)" },
  { path: 'src/workshop/shell/loader.ts', match: /^(gave up after repeated faults|the graphics context was lost and did not come back|the stage could not be rebuilt after a lost graphics context|to usable)$/, reason: "why the stage gave up (window.__handoff.failed, for tests and the console) and a performance mark's name" },
  { path: 'src/workshop/view/vignette.ts', match: /^(view: \w+|stand-in \(.*\)|none yet|set \(static body\))$/, reason: "the vignette's slot report (which piece fills each slot) for check-vignette and the console" },
];

export interface Hit {
  path: string;
  line: number;
  text: string;
  why: string;
}

const GLSL = /\b(gl_FragColor|gl_Position|void\s+main|uniform\s|varying\s|#include|precision\s+(high|medium|low)p|texture2D|vec[234]\s*\(|#define|#ifdef)\b|#include\b|#ifdef\b|#define\b/;
const CSS = /[\w-]+\s*:\s*[^;]+;|^[.#]?[\w-]+(\s*[>+~]\s*|\s+)[.#][\w-]+|^\s*@(media|keyframes|font-face)\b|^\s*\(\s*[\w-]+\s*:\s*[\w-]+\s*\)/;
const CLASS_LIST = /^\s*[a-z][a-z0-9]*(-[a-z0-9]*)*(\s+[a-z][a-z0-9]*(-[a-z0-9]*)*)*\s*$/;

/** True when a string reads like words for a person: two or more words of letters and nothing only code has. */
export function prose(s: string): boolean {
  const t = s.trim();
  if (t.length < 3) return false;
  if (/[=<>{}_\\/#$@|^~`]|\.\w|::|=>|\w\(/.test(t)) return false; // code, ids, paths, selectors, calls
  if (/\b[a-z]+[A-Z]\w*\b/.test(t)) return false; // camelCase
  const words = t.split(/\s+/).filter((w) => /^[("'‘“]?[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*[)"'’”.,;:!?…]*$/.test(w));
  const all = t.split(/\s+/).length;
  if (words.length < 2 || !words.some((w) => /[A-Za-zÀ-ÿ]{2}/.test(w))) return false;
  if (words.length < all * 0.75) return false; // mostly numbers, units, symbols
  // units and CSS values ('11px ui-monospace', 'bold 24px Inter'): a word list with a number+unit is a spec
  if (/\b\d+(\.\d+)?(px|em|rem|vh|vw|ms|s|deg|%)\b/.test(t)) return false;
  return true;
}

/** True when a string is code by its shape whatever its context: shader source or CSS. */
export function notProse(s: string): boolean {
  return GLSL.test(s) || CSS.test(s) || (CLASS_LIST.test(s) && s.includes('-'));
}

/** The callee of each open parenthesis, as a dotted name ('console.warn', 'Error'), or '' for a bare group. */
function calleeAt(toks: Token[], open: number): string {
  const parts: string[] = [];
  let k = open - 1;
  while (k >= 0) {
    const t = toks[k]!;
    if (t.type === 'ident') {
      parts.unshift(t.value);
      if (toks[k - 1]?.type === 'punct' && (toks[k - 1]!.value === '.' || toks[k - 1]!.value === '?.')) {
        k -= 2;
        continue;
      }
    }
    break;
  }
  return parts.join('.');
}

/** Why a literal at token `i` is code by where it stands, or null. */
export function codeContext(toks: Token[], i: number, stack: string[]): string | null {
  if (stack.some((c) => DEV_CALLS.test(c))) return 'error/log argument';
  if (stack.some((c) => c.startsWith('{') && DEV_BLOCKS.has(c.slice(1)))) return 'catalogue options';
  const inner = stack[stack.length - 1] ?? '';
  if (inner !== '' && !inner.startsWith('{') && inner !== '[' && inner !== '${' && CODE_CALLS.test(inner)) return 'argument of a call that takes code';
  const prev = toks[i - 1], next = toks[i + 1];
  if (prev?.type === 'ident' && (prev.value === 'from' || prev.value === 'import' || prev.value === 'export')) return 'import specifier';
  if (inner === 'import') return 'import specifier';
  const t = toks[i]!;
  // an object key: 'M blue': {...} (a plain string followed by a colon inside braces; not a ternary's branch)
  if (t.type === 'str' && next?.type === 'punct' && next.value === ':' && inner.startsWith('{')) return 'object key';
  // a value under a developer's key: note: '…', error: '…'
  if (prev?.type === 'punct' && prev.value === ':' && (toks[i - 2]?.type === 'ident' || toks[i - 2]?.type === 'str') && DEV_KEYS.test(toks[i - 2]!.value)) return 'developer key';
  // a developer's property: x.error = '…'
  if (prev?.type === 'punct' && prev.value === '=' && toks[i - 2]?.type === 'ident' && DEV_KEYS.test(toks[i - 2]!.value) && toks[i - 3]?.value === '.') return 'developer property';
  // a problem report: `${subject}: what is wrong`; a log line: 'module: what happened' (the codebase's log form)
  if (t.type === 'tmpl' && t.cont && /^:\s/.test(t.value)) return 'problem report';
  if (/^[a-z][\w-]*: /.test(t.value)) return 'log line';
  return null;
}

/** A literal written straight into what a visitor sees (a DOM text property, a visible attribute), or null. */
function sinkOf(toks: Token[], i: number, stack: string[], argIndex: number[]): string | null {
  const p1 = toks[i - 1], p2 = toks[i - 2], p3 = toks[i - 3];
  if (p1?.type === 'punct' && p1.value === '=' && p2?.type === 'ident' && VISIBLE_PROPS.has(p2.value) && p3?.type === 'punct' && p3.value === '.') return `.${p2.value} =`;
  const callee = stack[stack.length - 1] ?? '';
  if (/(^|\.)setAttribute$/.test(callee) && argIndex[argIndex.length - 1] === 1) {
    // the attribute's name is the first argument: setAttribute('aria-label', '...')
    const name = toks[i - 2];
    if (name?.type === 'str' && VISIBLE_ATTRS.has(name.value)) return `setAttribute('${name.value}')`;
  }
  return null;
}

/** Every prose literal in a file of code. */
export function scanCode(path: string, code: string): Hit[] {
  const toks = tokenize(code);
  const out: Hit[] = [];
  const stack: string[] = [];
  const argIndex: number[] = [];
  const tmplCtx: (string | null)[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (t.type === 'punct') {
      if (t.value === '(' || t.value === '[' || t.value === '{') {
        // '(' carries its callee; '{' carries the key it is the value of ('{variants'), if any
        const key = toks[i - 1]?.value === ':' && toks[i - 2]?.type === 'ident' ? toks[i - 2]!.value : '';
        stack.push(t.value === '(' ? calleeAt(toks, i) || '(' : t.value === '{' ? `{${key}` : t.value);
        argIndex.push(0);
      } else if (t.value === ')' || t.value === ']' || t.value === '}') {
        stack.pop();
        argIndex.pop();
      } else if (t.value === ',' && argIndex.length) argIndex[argIndex.length - 1]!++;
      continue;
    }
    if (t.type !== 'str' && t.type !== 'tmpl') continue;
    // a template's \${ … } opens a level the tokenizer does not show as punctuation; its next chunk closes it
    if (t.type === 'tmpl' && t.cont) {
      stack.pop();
      argIndex.pop();
    }
    if (t.type === 'tmpl' && t.open) {
      stack.push('${');
      argIndex.push(0);
    }
    const text = t.value;
    // a template's later chunks stand where its first chunk stands
    let ctx: string | null;
    if (t.type === 'tmpl' && t.cont) {
      ctx = tmplCtx[tmplCtx.length - 1] ?? codeContext(toks, i, stack);
      if (!t.open) tmplCtx.pop();
    } else {
      ctx = codeContext(toks, i, stack);
      if (t.type === 'tmpl' && t.open) tmplCtx.push(ctx);
    }
    if (!/[A-Za-z]/.test(text)) continue;
    if (ctx) continue;
    if (t.type === 'tmpl' && notProse(text)) continue;
    const sink = sinkOf(toks, i, stack, argIndex);
    if (sink && text.trim() !== '') {
      out.push({ path, line: t.line, text, why: `literal written into ${sink}` });
      continue;
    }
    if (notProse(text)) continue;
    if (prose(text)) out.push({ path, line: t.line, text, why: 'reads like prose' });
  }
  return out;
}

/** Text a visitor reads in an .astro file's markup: text nodes and visible attribute values (with their line). */
export function markupText(src: string): { line: number; text: string; attr?: string }[] {
  const code = codeOf('x.astro', src) ?? '';
  // the markup is what codeOf blanked: frontmatter and scripts become spaces here, lines kept
  let m = '';
  for (let i = 0; i < src.length; i++) m += code[i] !== ' ' && code[i] !== '\n' ? ' ' : src[i];
  m = m.replace(/<style\b[\s\S]*?<\/style>/gi, (s) => s.replace(/[^\n]/g, ' '));
  m = m.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '));
  const out: { line: number; text: string; attr?: string }[] = [];
  const lineAt = (i: number): number => m.slice(0, i).split('\n').length;
  // states: markup text, inside {expression} (JavaScript), and markup inside an expression (JSX)
  const modes: ('markup' | 'expr' | 'jsx')[] = ['markup'];
  const jsxDepth: number[] = [];
  let text = '';
  let textStart = 0;
  const flush = (): void => {
    const t = text.replace(/&[a-z]+;|&#\d+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (/[A-Za-z]/.test(t)) out.push({ line: lineAt(textStart), text: t });
    text = '';
  };
  let i = 0;
  const n = m.length;
  const readTag = (): { closing: boolean; self: boolean; fragment: boolean } => {
    // at '<': read to the matching '>', attributes and {…} values included
    const start = i;
    i++;
    const closing = m[i] === '/';
    if (closing) i++;
    const fragment = m[i] === '>';
    let depth = 0;
    let quote = '';
    while (i < n) {
      const c = m[i]!;
      if (quote) {
        if (c === quote) quote = '';
      } else if (depth > 0) {
        if (c === '{') depth++;
        else if (c === '}') depth--;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '>') break;
      i++;
    }
    const body = m.slice(start, i + 1);
    i++;
    {
      const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      for (let a = re.exec(body); a; a = re.exec(body)) {
        const name = a[1]!.toLowerCase();
        const value = a[3] ?? a[4] ?? '';
        if (VISIBLE_ATTRS.has(name) && /[A-Za-z]/.test(value)) out.push({ line: lineAt(start + a.index), text: value, attr: name });
      }
    }
    return { closing, self: /\/\s*>$/.test(body), fragment };
  };
  while (i < n) {
    const mode = modes[modes.length - 1]!;
    const c = m[i]!;
    if (mode === 'expr') {
      if (c === '"' || c === "'" || c === '`') {
        const q = c;
        i++;
        while (i < n && m[i] !== q) i += m[i] === '\\' ? 2 : 1;
        i++;
      } else if (c === '{') {
        modes.push('expr');
        i++;
      } else if (c === '}') {
        modes.pop();
        i++;
      } else if (c === '<' && /[A-Za-z>]/.test(m[i + 1] ?? '')) {
        const tag = readTag();
        if (!tag.self) {
          modes.push('jsx');
          jsxDepth.push(1);
        }
      } else i++;
      continue;
    }
    // markup or jsx
    if (c === '<' && /[A-Za-z/>!]/.test(m[i + 1] ?? '')) {
      flush();
      const tag = readTag();
      if (mode === 'jsx') {
        const d = jsxDepth.length - 1;
        if (tag.closing) jsxDepth[d]!--;
        else if (!tag.self) jsxDepth[d]!++;
        if (jsxDepth[d] === 0) {
          jsxDepth.pop();
          modes.pop();
        }
      }
      textStart = i;
      continue;
    }
    if (c === '{') {
      flush();
      modes.push('expr');
      i++;
      textStart = i;
      continue;
    }
    if (text === '') textStart = i;
    text += c;
    i++;
  }
  flush();
  return out;
}

export function scanMarkup(path: string, src: string): Hit[] {
  const hits: Hit[] = markupText(src).map((t) => ({ path, line: t.line, text: t.text, why: t.attr ? `visible attribute ${t.attr}` : 'text in the markup' }));
  const code = codeOf(path, src);
  if (code) hits.push(...scanCode(path, code));
  return hits;
}

function files(root: string, dirs: readonly string[], ext: RegExp): string[] {
  const out: string[] = [];
  for (const d of dirs) {
    let list: string[] = [];
    try {
      list = walk(join(root, d));
    } catch {
      continue;
    }
    for (const f of list) if (ext.test(f)) out.push(posix.join(d, f));
  }
  return out.sort();
}

export function scan(root: string): Hit[] {
  const hits: Hit[] = [];
  for (const p of files(root, CODE_DIRS, /\.(m|c)?[jt]sx?$|\.astro$/)) {
    const src = readFileSync(join(root, p), 'utf8');
    hits.push(...(p.endsWith('.astro') ? scanMarkup(p, src) : scanCode(p, src)));
  }
  for (const p of files(root, MARKUP_DIRS, /\.astro$|\.(m|c)?[jt]sx?$/)) {
    const src = readFileSync(join(root, p), 'utf8');
    hits.push(...(p.endsWith('.astro') ? scanMarkup(p, src) : scanCode(p, src)));
  }
  return hits;
}

export function checkProse(root: string): Report {
  const r = new Report('check-prose');
  const used = new Map<number, number>();
  for (const h of scan(root)) {
    const a = ALLOW.findIndex((x) => x.path === h.path && x.match.test(h.text));
    if (a >= 0) {
      used.set(a, (used.get(a) ?? 0) + 1);
      continue;
    }
    r.fail(`${h.path}:${h.line} ${JSON.stringify(h.text.length > 90 ? `${h.text.slice(0, 90)}…` : h.text)}: ${h.why}; visible words live in src/content/`);
  }
  ALLOW.forEach((x, k) => {
    const n = used.get(k) ?? 0;
    if (n === 0) r.fail(`ALLOW entry no longer matches anything: ${x.path} ${x.match}; delete it`);
    else r.exempt(`${x.path}: ${n} literal${n === 1 ? '' : 's'} (${x.reason})`);
  });
  return r;
}

runCli(import.meta.url, { name: 'check-prose', summary: 'No visible words outside src/content/ (REWRITE.md § E4 invariant 5).', usesDist: false }, (o) => checkProse(o.root));
