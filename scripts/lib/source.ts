// Source files of the workshop, and resolving their import specifiers to
// repository paths (for the layer and look checks).

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isDir, isFile, walk } from './fsutil.ts';
import { codeOf } from './jstok.ts';

export interface SourceFile {
  /** Repository-relative path with forward slashes. */
  path: string;
  /** Code to scan (non-code parts of .astro blanked, lines kept). */
  code: string;
}

/** Every scannable source file under the given repository-relative directories. */
export function sourceFiles(root: string, dirs: readonly string[]): SourceFile[] {
  const out: SourceFile[] = [];
  for (const d of dirs) {
    for (const f of walk(join(root, d))) {
      const path = posix.join(d, f);
      const code = codeOf(path, readFileSync(join(root, path), 'utf8'));
      if (code !== null) out.push({ path, code });
    }
  }
  return out;
}

/** Path aliases, from tsconfig.json `compilerOptions.paths` when present, else the usual ones. */
export function loadAliases(root: string): [string, string][] {
  const fallback: [string, string][] = [['@/', 'src/'], ['~/', 'src/']];
  const p = join(root, 'tsconfig.json');
  if (!isFile(p)) return fallback;
  try {
    const raw = readFileSync(p, 'utf8');
    // tsconfig is JSONC: drop comments outside strings and trailing commas.
    let s = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') {
        const start = i;
        i++;
        while (i < raw.length && raw[i] !== '"') i += raw[i] === '\\' ? 2 : 1;
        s += raw.slice(start, i + 1);
        continue;
      }
      if (c === '/' && raw[i + 1] === '/') {
        while (i < raw.length && raw[i] !== '\n') i++;
        s += '\n';
        continue;
      }
      if (c === '/' && raw[i + 1] === '*') {
        const e = raw.indexOf('*/', i + 2);
        i = e < 0 ? raw.length : e + 1;
        continue;
      }
      s += c;
    }
    s = s.replace(/,(\s*[}\]])/g, '$1');
    const json = JSON.parse(s) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const base = json.compilerOptions?.baseUrl ?? '.';
    const paths = json.compilerOptions?.paths ?? {};
    const out: [string, string][] = [];
    for (const [k, v] of Object.entries(paths)) {
      if (!v[0]) continue;
      const from = k.replace(/\*$/, '');
      out.push([from, posix.join(base, v[0].replace(/\*$/, ''))]);
    }
    return out.length ? out : fallback;
  } catch {
    return fallback;
  }
}

export type Target =
  | { kind: 'file'; path: string }
  | { kind: 'package'; name: string; specifier: string }
  | { kind: 'virtual'; specifier: string };

const EXT = /\.(m|c)?[jt]sx?$/;

/** Where an import specifier written in `fromPath` points. */
export function resolveSpecifier(root: string, fromPath: string, spec: string, aliases: [string, string][]): Target {
  let s = spec.split('?')[0];
  for (const [from, to] of aliases) {
    if (s === from.replace(/\/$/, '') || s.startsWith(from)) {
      s = to + s.slice(from.length);
      return { kind: 'file', path: normalizeModulePath(root, posix.normalize(s)) };
    }
  }
  if (s.startsWith('.')) {
    return { kind: 'file', path: normalizeModulePath(root, posix.normalize(posix.join(posix.dirname(fromPath), s))) };
  }
  if (s.startsWith('/')) return { kind: 'file', path: normalizeModulePath(root, posix.normalize(s.slice(1))) };
  if (/^src\//.test(s)) return { kind: 'file', path: normalizeModulePath(root, posix.normalize(s)) };
  if (/^[a-z]+:/i.test(s) && !s.startsWith('node:')) return { kind: 'virtual', specifier: spec };
  const parts = s.replace(/^node:/, '').split('/');
  const name = s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return { kind: 'package', name: s.startsWith('node:') ? 'node:' + name : name, specifier: spec };
}

/** `src/a/b.js` → `src/a/b.ts` if that exists; a directory → its index. Extensionless kept as written. */
function normalizeModulePath(root: string, p: string): string {
  if (isDir(join(root, p))) {
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) if (isFile(join(root, p, 'index' + ext))) return `${p}/index${ext}`;
    return `${p}/index.ts`;
  }
  if (isFile(join(root, p))) return p;
  const stem = p.replace(EXT, '');
  for (const ext of ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx']) if (isFile(join(root, stem + ext))) return stem + ext;
  return p;
}

/** File name without directory or script extension: `src/x/types.ts` → `types`. */
export function stem(path: string): string {
  return posix.basename(path).replace(EXT, '');
}

export function under(path: string, dir: string): boolean {
  const d = dir.endsWith('/') ? dir : dir + '/';
  return path.startsWith(d);
}

