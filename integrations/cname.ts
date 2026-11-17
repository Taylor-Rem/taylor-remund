import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/**
 * Copies the root `CNAME` into the build output, byte for byte (REWRITE.md § 2,
 * § E11). The source file stays at the repo root and is never edited.
 */
export default function cname(): AstroIntegration {
  let root: URL;
  return {
    name: 'workshop:cname',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = config.root;
      },
      'astro:build:done': ({ dir, logger }) => {
        copyFileSync(fileURLToPath(new URL('CNAME', root)), fileURLToPath(new URL('CNAME', dir)));
        logger.info('copied CNAME');
      },
    },
  };
}
