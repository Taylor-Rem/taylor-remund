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
});
