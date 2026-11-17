// Resolving references found in built pages to files in the output.

import { join } from 'node:path';
import { isDir, isFile } from './fsutil.ts';
import { SITE_HOSTS, SITE_ORIGIN } from '../site.ts';

export type Ref =
  | { kind: 'skip'; scheme: string }
  | { kind: 'external'; url: string; host: string }
  | { kind: 'internal'; path: string; fragment: string | null };

const SKIP_SCHEMES = ['mailto:', 'tel:', 'sms:', 'data:', 'javascript:', 'blob:', 'about:'];

/** The URL path a file in the output answers (`resume/index.html` → `/resume/`). */
export function urlPathForFile(rel: string): string {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  return '/' + rel;
}

/** Classifies `ref` as written on the page at URL path `pagePath`. */
export function classify(ref: string, pagePath: string): Ref {
  const r = ref.trim();
  const lower = r.toLowerCase();
  for (const s of SKIP_SCHEMES) if (lower.startsWith(s)) return { kind: 'skip', scheme: s };
  let u: URL;
  try {
    u = new URL(r, SITE_ORIGIN + pagePath);
  } catch {
    return { kind: 'internal', path: r, fragment: null };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'skip', scheme: u.protocol };
  if (!SITE_HOSTS.includes(u.hostname)) return { kind: 'external', url: u.href, host: u.hostname };
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep as written
  }
  const fragment = u.hash ? decodeURIComponentSafe(u.hash.slice(1)) : null;
  return { kind: 'internal', path, fragment: fragment === '' ? null : fragment };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The file in `dist` that answers URL path `path` the way GitHub Pages does:
 * a trailing slash serves index.html; a directory without the slash
 * redirects to it; `/name` also finds `name.html`. Null when nothing answers.
 */
export function resolveToFile(dist: string, path: string): string | null {
  const rel = path.replace(/^\/+/, '');
  if (rel === '' || path.endsWith('/')) {
    const f = join(dist, rel, 'index.html');
    return isFile(f) ? f : null;
  }
  const direct = join(dist, rel);
  if (isFile(direct)) return direct;
  if (isDir(direct)) {
    const f = join(direct, 'index.html');
    return isFile(f) ? f : null;
  }
  const html = direct + '.html';
  if (isFile(html)) return html;
  return null;
}

/** Normalises an internal URL path to its canonical page form (`/privacy` → `/privacy/`). */
export function canonicalPagePath(path: string): string {
  let p = path;
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length);
  if (!p.endsWith('/') && !/\.[A-Za-z0-9]+$/.test(p.split('/').pop() ?? '')) p += '/';
  return p;
}
