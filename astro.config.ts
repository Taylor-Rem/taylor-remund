import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import bakeTable from './integrations/bake-table.ts';
import cname from './integrations/cname.ts';
import devPages from './integrations/dev-pages.ts';

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
  integrations: [cname(), devPages(), bakeTable()],
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
    // (E1) a build with the development pages is a development build for the late loader's switches (`?pitch=1`)
    // and `WORKSHOP_PITCH=1` builds the page with Pitch on, as `PITCH_ON` would (the browser test on the wire; never deployed)
    define: { __WORKSHOP_DEV_BUILD__: JSON.stringify(process.env['WORKSHOP_DEV_PAGES'] === '1'), __WORKSHOP_PITCH__: JSON.stringify(process.env['WORKSHOP_PITCH'] === '1') },
    // The stage's code in a few chunks instead of a hundred (K1): three, the pieces, the station views.
    // Each small chunk paid its own gzip dictionary and request; grouped, the bench fetches ~50 KB and
    // ~55 requests fewer, with no measurable change in time to usable (shots/k2 in the K1 worktree).
    // Only these trees are grouped: the conventional pages' scripts are untouched.
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // the physics adapter and the clock it needs, on their own (B1): a stage page's first small script
              // starts the engine with them; in the 350 KB station chunk they cost the engine a round trip
              { name: 'physics', test: /\/src\/workshop\/sim\/(physics\/rapier|clock)\.ts$/, priority: 4 },
              { name: 'three', test: /\/node_modules\/three\//, priority: 3 },
              // (E1: never a late unit's piece or view: they are the late groups' below)
              { name: 'pieces', test: /\/src\/workshop\/view\/kit\/pieces\/(?!pitch\/)/, priority: 2 },
              { name: 'stations', test: /\/src\/workshop\/view\/stations\/(?!pitch\.ts)/, priority: 1 },
              // (E1) a late unit: a crew member who arrives after the bench is usable, in a chunk of his own (shell/late.ts).
              // Below every other group: a group takes what its modules import as well, unless a group before it has
              // (so everything he shares with the bench stays in the bench's chunks, and only his own modules are here).
              // Chunks named `late-*` are what scripts/budget.ts counts in the "after" row; it fails if one is reached eagerly.
              { name: 'late-pitch', test: /\/src\/workshop\/(view\/kit\/pieces\/pitch\/|view\/stations\/pitch\.ts|view\/late\/pitch(-worker)?\.ts|sim\/crew\/pitch\.ts|sim\/scenes\/bench-pitch\.ts)/, priority: 0 },
            ],
          },
        },
      },
    },
  },
});
