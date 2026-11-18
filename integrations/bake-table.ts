import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { codeHash, inputsHash, readInfo } from '../scripts/bake.ts';

/**
 * Hands the page the hashes of the sources it is built from (K1;
 * src/workshop/view/kit/bake.ts): the bake's code and everything that shapes
 * the pieces. The page uses the shipped bake table only if it was recorded
 * under the same bake code, and its measurements only if under the same
 * sources too, so a table left behind by a change is never applied wrongly:
 * at worst the work is done live. Says so at build time when it is stale.
 */
export default function bakeTable(): AstroIntegration {
  return {
    name: 'workshop:bake-table',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, logger }) => {
        const root = fileURLToPath(config.root);
        const sources = { code: codeHash(root), inputs: inputsHash(root) };
        updateConfig({ vite: { define: { __WORKSHOP_BAKE__: JSON.stringify(sources) } } });
        const info = readInfo(root);
        if (!info) logger.warn('no bake table: every piece bakes live (node scripts/bake.ts)');
        else if (info.codeHash !== sources.code) logger.warn('the bake table was recorded under other bake code: not used; every piece bakes live (node scripts/bake.ts)');
        else if (info.inputsHash !== sources.inputs) logger.warn('the bake table is older than the pieces: changed pieces bake live and pieces are measured live (node scripts/bake.ts)');
      },
    },
  };
}
