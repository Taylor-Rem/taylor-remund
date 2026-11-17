import { defineConfig } from 'astro/config';
import cname from './integrations/cname.ts';
import devPages from './integrations/dev-pages.ts';
import legacyPassthrough from './integrations/legacy-passthrough.ts';

// REWRITE.md § E1, § E11: static output, directory URLs, built into dist/.
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
  integrations: [cname(), legacyPassthrough(), devPages()],
  // Agent worktrees live under .claude/worktrees/ (git-ignored copies of the
  // project); the dev server must not watch or serve them.
  vite: {
    server: { watch: { ignored: ['**/.claude/**', '**/shots/**', '**/legacy/**'] } },
    // Rapier's wasm glue must not be pre-bundled: Vite's dependency optimiser
    // loads it twice and the dev server fails with "reading '__wbindgen_export'".
    optimizeDeps: { exclude: ['@dimforge/rapier3d'] },
  },
});
