/**
 * Test-only: make Rapier's wasm load correctly under Vitest in Node.
 *
 * Why: the package is wasm-bindgen's "bundler" build: `rapier_wasm3d.js`
 * does `import * as wasm from "./rapier_wasm3d_bg.wasm"` and the wasm in
 * turn imports its JS glue `./rapier_wasm3d_bg.js`. Vitest hands `.wasm`
 * to Node's own ES-module loader, which then loads a SECOND copy of the
 * glue natively, while the rest of Rapier uses the copy Vite's runner
 * loaded. Calls from wasm back into JS land in the copy whose `wasm` was
 * never set, and the first callback crashes (`reading '__wbindgen_export'`).
 *
 * Here the wasm module is replaced by one instantiated against the runner's
 * copy of the glue, so there is one glue and one heap. The browser build
 * does not need this (Vite 8 bundles the wasm import itself).
 *
 * A config-level alternative, if the lead prefers it: in vitest.config.ts,
 * `test.server.deps.inline: [/@dimforge\/rapier3d/]` has the same effect.
 */
import { vi } from 'vitest';

vi.mock('@dimforge/rapier3d/rapier_wasm3d_bg.wasm', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const bytes = await readFile(require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm'));
  // the glue has no typings of its own (its types live in rapier_wasm3d.d.ts); only its exports object is needed
  const gluePath = '@dimforge/rapier3d/rapier_wasm3d_bg.js';
  const glue: unknown = await import(/* @vite-ignore */ gluePath);
  const { instance } = await WebAssembly.instantiate(bytes, { './rapier_wasm3d_bg.js': glue as unknown as WebAssembly.ModuleImports });
  return instance.exports;
});
