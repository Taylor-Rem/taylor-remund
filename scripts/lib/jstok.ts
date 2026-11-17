// A small JavaScript/TypeScript tokenizer: enough to find imports, calls and
// literals without being fooled by comments, strings, template literals or
// regular expressions. Not a parser.

export type TokType = 'ident' | 'num' | 'str' | 'tmpl' | 'regex' | 'punct';

export interface Token {
  type: TokType;
  /** Identifier name, punctuator, number text, string contents (escapes resolved), template chunk text. */
  value: string;
  /** 1-based line of the token's start. */
  line: number;
  /** For 'tmpl': true when this chunk is followed by `${` (the template has expressions). */
  open?: boolean;
  /** For 'tmpl': true when this chunk continues after a `}`. */
  cont?: boolean;
}

const REGEX_AFTER_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

const SIMPLE_ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const braceStack: number[] = [];
  let braceDepth = 0;

  const regexAllowed = (): boolean => {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.type === 'num' || p.type === 'str' || p.type === 'regex') return false;
    if (p.type === 'tmpl') return p.open === true;
    if (p.type === 'ident') return REGEX_AFTER_KEYWORDS.has(p.value);
    return p.value !== ')' && p.value !== ']';
  };

  const readTemplate = (cont: boolean): void => {
    const startLine = line;
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        const d = src[i + 1] ?? '';
        if (d === '\n') line++;
        s += SIMPLE_ESC[d] ?? d;
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        toks.push({ type: 'tmpl', value: s, line: startLine, cont });
        return;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        toks.push({ type: 'tmpl', value: s, line: startLine, open: true, cont });
        braceStack.push(braceDepth);
        braceDepth = 0;
        return;
      }
      if (c === '\n') line++;
      s += c;
      i++;
    }
    toks.push({ type: 'tmpl', value: s, line: startLine, cont });
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === '#' && i === 0 && src[1] === '!') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const startLine = line;
      let s = '';
      i++;
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') {
          const d = src[i + 1] ?? '';
          if (d === '\n') line++;
          s += SIMPLE_ESC[d] ?? d;
          i += 2;
          continue;
        }
        s += src[i++];
      }
      i++;
      toks.push({ type: 'str', value: s, line: startLine });
      continue;
    }
    if (c === '`') {
      i++;
      readTemplate(false);
      continue;
    }
    const idm = /^[A-Za-z_$\u0080-￿#][\w$\u0080-￿]*/.exec(src.slice(i, i + 256));
    if (idm && !(c === '#' && idm[0].length === 1)) {
      toks.push({ type: 'ident', value: idm[0], line });
      i += idm[0].length;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:[0-9][0-9_]*)?\.?[0-9][0-9_]*(?:[eE][+-]?[0-9]+)?n?)/.exec(src.slice(i, i + 64));
      const text = m ? m[0] : c;
      toks.push({ type: 'num', value: text, line });
      i += text.length;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      const startLine = line;
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const d = src[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[A-Za-z]/.test(src[j])) j++;
      toks.push({ type: 'regex', value: src.slice(i, j), line: startLine });
      i = j;
      continue;
    }
    if (c === '{') {
      braceDepth++;
      toks.push({ type: 'punct', value: c, line });
      i++;
      continue;
    }
    if (c === '}') {
      if (braceStack.length > 0 && braceDepth === 0) {
        braceDepth = braceStack.pop() ?? 0;
        i++;
        readTemplate(true);
        continue;
      }
      braceDepth--;
      toks.push({ type: 'punct', value: c, line });
      i++;
      continue;
    }
    if (c === '?' && src[i + 1] === '.' && !/[0-9]/.test(src[i + 2] ?? '')) {
      toks.push({ type: 'punct', value: '?.', line });
      i += 2;
      continue;
    }
    if (c === '=' && src[i + 1] === '>') {
      toks.push({ type: 'punct', value: '=>', line });
      i += 2;
      continue;
    }
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') {
      toks.push({ type: 'punct', value: '...', line });
      i += 3;
      continue;
    }
    if (c === '=' && src[i + 1] === '=') {
      const len = src[i + 2] === '=' ? 3 : 2;
      toks.push({ type: 'punct', value: src.slice(i, i + len), line });
      i += len;
      continue;
    }
    toks.push({ type: 'punct', value: c, line });
    i++;
  }
  return toks;
}

export interface ImportRef {
  specifier: string | null;
  line: number;
  kind: 'static' | 'reexport' | 'dynamic' | 'require';
  typeOnly: boolean;
}

/** Every module reference: import/export-from, dynamic import(), require(). */
export function findImports(toks: Token[]): ImportRef[] {
  const out: ImportRef[] = [];
  const isDot = (t: Token | undefined): boolean => !!t && t.type === 'punct' && (t.value === '.' || t.value === '?.');
  const literal = (t: Token | undefined): string | null => {
    if (!t) return null;
    if (t.type === 'str') return t.value;
    if (t.type === 'tmpl' && !t.open && !t.cont) return t.value;
    return null;
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== 'ident' || isDot(toks[k - 1])) continue;
    const next = toks[k + 1];
    if (t.value === 'import') {
      if (!next) continue;
      if (next.type === 'punct' && next.value === '.') continue; // import.meta
      if (next.type === 'punct' && next.value === '(') {
        const spec = literal(toks[k + 2]);
        const closes = toks[k + 3]?.value === ')' || toks[k + 3]?.value === ',';
        out.push({ specifier: spec !== null && closes ? spec : null, line: t.line, kind: 'dynamic', typeOnly: false });
        continue;
      }
      if (next.type === 'str') {
        out.push({ specifier: next.value, line: t.line, kind: 'static', typeOnly: false });
        continue;
      }
      const typeOnly = next.type === 'ident' && next.value === 'type' && toks[k + 2]?.value !== 'from' && toks[k + 2]?.value !== ',';
      // scan to `from "x"`
      for (let m = k + 1; m < toks.length && m < k + 400; m++) {
        const u = toks[m];
        if (u.type === 'punct' && u.value === ';') break;
        if (u.type === 'ident' && u.value === 'from' && toks[m + 1]?.type === 'str') {
          out.push({ specifier: toks[m + 1].value, line: t.line, kind: 'static', typeOnly });
          k = m + 1;
          break;
        }
      }
      continue;
    }
    if (t.value === 'export') {
      let m = k + 1;
      let typeOnly = false;
      if (toks[m]?.type === 'ident' && toks[m].value === 'type') {
        typeOnly = true;
        m++;
      }
      const head = toks[m];
      if (!head || head.type !== 'punct') continue;
      if (head.value === '{') {
        let depth = 0;
        for (; m < toks.length; m++) {
          if (toks[m].value === '{' && toks[m].type === 'punct') depth++;
          else if (toks[m].value === '}' && toks[m].type === 'punct') {
            depth--;
            if (depth === 0) break;
          }
        }
        m++;
      } else if (head.value === '*') {
        m++;
        if (toks[m]?.value === 'as') m += 2;
      } else continue;
      if (toks[m]?.type === 'ident' && toks[m].value === 'from' && toks[m + 1]?.type === 'str') {
        out.push({ specifier: toks[m + 1].value, line: t.line, kind: 'reexport', typeOnly });
        k = m + 1;
      }
      continue;
    }
    if (t.value === 'require' && next?.type === 'punct' && next.value === '(') {
      const spec = literal(toks[k + 2]);
      out.push({ specifier: spec, line: t.line, kind: 'require', typeOnly: false });
    }
  }
  return out;
}

/** The scannable code of a source file: whole file for JS/TS; frontmatter and scripts for .astro. Other files: null. */
export function codeOf(file: string, text: string): string | null {
  if (/\.(m|c)?[jt]sx?$/.test(file)) return text;
  if (file.endsWith('.astro')) {
    // Keep line numbers: blank out everything that is not code.
    const keep: [number, number][] = [];
    const fm = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (fm) {
      const s = text.indexOf(fm[1]);
      keep.push([s, s + fm[1].length]);
    }
    const sre = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    for (let m = sre.exec(text); m; m = sre.exec(text)) {
      const s = m.index + m[0].indexOf('>') + 1;
      keep.push([s, s + m[1].length]);
    }
    keep.sort((x, y) => x[0] - y[0]);
    let out = '';
    let pos = 0;
    for (const [a, b] of keep) {
      if (a < pos) continue;
      out += text.slice(pos, a).replace(/[^\n]/g, ' ') + text.slice(a, b);
      pos = b;
    }
    out += text.slice(pos).replace(/[^\n]/g, ' ');
    return out;
  }
  return null;
}
