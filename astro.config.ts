import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import bakeTable from './integrations/bake-table.ts';
import cname from './integrations/cname.ts';
import devPages from './integrations/dev-pages.ts';
import legacyPassthrough from './integrations/legacy-passthrough.ts';

// REWRITE.md § E1, § E11: static output, directory URLs, built into dist/.
const here = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  site: 'https://taylorremund.com',
  output: 'static',
  outDir: 'dist',
  build: { format: 'directory' },
  // Astro 7 defaults to 'jsx' whitespace rules, which rewrite whitespace in
  // templates. The compliance pages must carry their text of record byte for
  // byte (§ E8), so no HTML compression anywhere.
  compressHTML: false,
  devToolbar: { enabled: false },
  integrations: [cname(), legacyPassthrough(), devPages(), bakeTable()],
  // Agent worktrees live under .claude/worktrees/ (git-ignored copies of the
  // project); the dev server must not watch or serve them.
  vite: {
    // Ignore THIS checkout's .claude/ (other agents' worktrees), by absolute path:
    // a '**/.claude/**' glob would also match a worktree's own files, since a
    // worktree lives under .claude/worktrees/, and its dev server would never reload.
    server: { watch: { ignored: [`${here}/.claude/**`, `${here}/shots/**`, `${here}/legacy/**`] } },
    // Rapier's wasm glue must not be pre-bundled: Vite's dependency optimiser
    // loads it twice and the dev server fails with "reading '__wbindgen_export'".
    optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
    // The stage's code in a few chunks instead of a hundred (K1): three, the pieces, the station views.
    // Each small chunk paid its own gzip dictionary and request; grouped, the bench fetches ~50 KB and
    // ~55 requests fewer, with no measurable change in time to usable (shots/k2 in the K1 worktree).
    // Only these trees are grouped: the conventional pages' scripts are untouched.
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'three', test: /\/node_modules\/three\//, priority: 3 },
              { name: 'pieces', test: /\/src\/workshop\/view\/kit\/pieces\//, priority: 2 },
              { name: 'stations', test: /\/src\/workshop\/view\/stations\//, priority: 1 },
            ],
          },
        },
      },
    },
  },
});
