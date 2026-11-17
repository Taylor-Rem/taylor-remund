// Reading the old plain-HTML site: `legacy/<path>` on the rewrite branch,
// falling back to the published commit on main (`git show fa99b13:<path>`).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFile } from './fsutil.ts';
import { LEGACY_COMMIT } from '../site.ts';

/** True when `commit` is a commit object in the repository at `root`. */
export function gitHasCommit(root: string, commit: string = LEGACY_COMMIT): boolean {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${commit}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** The bytes of `<path>` at `commit`, or null when git cannot give them. */
export function gitShow(root: string, path: string, commit: string = LEGACY_COMMIT): Buffer | null {
  try {
    return execFileSync('git', ['-C', root, 'show', `${commit}:${path}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export interface LegacyFile {
  bytes: Buffer;
  from: string;
}

/** A legacy source file: `legacy/<path>` first, then `git show fa99b13:<path>`. */
export function readLegacy(root: string, path: string): LegacyFile | null {
  const local = join(root, 'legacy', path);
  if (isFile(local)) return { bytes: readFileSync(local), from: `legacy/${path}` };
  const shown = gitShow(root, path);
  if (shown) return { bytes: shown, from: `git show ${LEGACY_COMMIT}:${path}` };
  return null;
}
