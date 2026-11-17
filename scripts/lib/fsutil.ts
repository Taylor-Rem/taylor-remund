// File-system helpers shared by the checks.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Every file under `dir`, as paths relative to it with forward slashes, sorted. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const visit = (d: string): void => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) visit(full);
      else if (ent.isFile()) out.push(toPosix(relative(dir, full)));
    }
  };
  visit(dir);
  return out.sort();
}

export function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/** A short quoted excerpt of `s` around `at` (for diffs). */
export function excerpt(s: string, at: number, width = 60): string {
  const start = Math.max(0, at - Math.floor(width / 2));
  return JSON.stringify(s.slice(start, start + width));
}

export function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}
