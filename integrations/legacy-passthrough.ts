import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

/**
 * TEMPORARY (until phase P3, REWRITE.md § F1): `/resume/` and `/ai/` are served
 * as the old hand-written files, byte for byte, together with the old
 * stylesheet and script their relative links point at. When those pages move
 * into the Paper layout, delete this integration and the entries below.
 *
 * `/style.css` is also what the provisional Paper layout links for the legal
 * typography; that goes away with this file too.
 */
const PASSTHROUGH: Record<string, string> = {
  // URL path (as served)  -> source under legacy/
  'resume/index.html': 'legacy/resume/index.html',
  'ai/index.html': 'legacy/ai/index.html',
  // (2026-11-19 on main: the case study the résumé's cards link to; it arrives here with a merge of main)
  'case-studies/ledger-repair/index.html': 'legacy/case-studies/ledger-repair/index.html',
  'style.css': 'legacy/style.css',
  'script.js': 'legacy/script.js',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function lookup(urlPath: string): string | undefined {
  let p = urlPath.split('?')[0]!.replace(/^\/+/, '');
  if (p === '') return undefined;
  if (p.endsWith('/')) p += 'index.html';
  return PASSTHROUGH[p];
}

export default function legacyPassthrough(): AstroIntegration {
  let root: URL;
  return {
    name: 'workshop:legacy-passthrough',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = config.root;
      },
      // `astro dev`: answer the same paths from legacy/.
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const source = req.url ? lookup(req.url) : undefined;
          if (!source) return next();
          const file = fileURLToPath(new URL(source, root));
          if (!existsSync(file)) return next();
          const ext = source.slice(source.lastIndexOf('.'));
          res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
          res.end(readFileSync(file));
        });
      },
      // `astro build`: copy them into the output.
      'astro:build:done': ({ dir, logger }) => {
        for (const [out, source] of Object.entries(PASSTHROUGH)) {
          const target = fileURLToPath(new URL(out, dir));
          if (existsSync(target)) {
            throw new Error(`legacy passthrough: ${out} was also produced by a page; remove one of them`);
          }
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(fileURLToPath(new URL(source, root)), target);
        }
        logger.info(`copied ${Object.keys(PASSTHROUGH).length} legacy files (temporary until P3)`);
      },
    },
  };
}
