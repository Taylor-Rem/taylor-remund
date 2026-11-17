import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/**
 * Pages in `src/dev-pages/` (workbenches, fixtures, previews) are served under
 * `/dev/<name>/` during `astro dev`, and in a build only when
 * `WORKSHOP_DEV_PAGES=1`. A normal `astro build` never contains them.
 *
 * `src/dev-pages/index.astro` -> `/dev/`, `src/dev-pages/foo.astro` -> `/dev/foo/`,
 * `src/dev-pages/foo/bar.astro` -> `/dev/foo/bar/`.
 */
export const DEV_PAGES_ENV = 'WORKSHOP_DEV_PAGES';

export function devPagesEnabled(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return command === 'dev' || env[DEV_PAGES_ENV] === '1';
}

/** Relative paths (posix) of every `.astro` file under `dir`, sorted. */
export function listDevPages(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  return entries
    .map((e) => e.split('\\').join('/'))
    .filter((e) => e.endsWith('.astro'))
    .sort();
}

/** `foo/index.astro` -> `/dev/foo`, `index.astro` -> `/dev`. */
export function devPagePattern(relative: string): string {
  const stem = relative.replace(/\.astro$/, '').replace(/(^|\/)index$/, '');
  return stem === '' ? '/dev' : `/dev/${stem}`;
}

export default function devPages(): AstroIntegration {
  return {
    name: 'workshop:dev-pages',
    hooks: {
      'astro:config:setup': ({ command, config, injectRoute, logger }) => {
        if (!devPagesEnabled(command)) return;
        const dir = new URL('src/dev-pages/', config.root);
        const pages = listDevPages(fileURLToPath(dir));
        for (const page of pages) {
          injectRoute({ pattern: devPagePattern(page), entrypoint: new URL(page, dir), prerender: true });
        }
        if (command === 'build') logger.warn(`${DEV_PAGES_ENV}=1: building ${pages.length} dev page(s) under /dev/`);
      },
    },
  };
}
