import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { checkLayers, layerViolations, machineOf } from '../../../scripts/check-layers.ts';
import { findImports, tokenize } from '../../../scripts/lib/jstok.ts';
import { tmp, write } from './helpers.ts';

function tree(files: Record<string, string>): string {
  const root = tmp('layers-');
  for (const [p, c] of Object.entries(files)) write(join(root, p), c);
  return root;
}

const rules = (root: string): string[] => layerViolations(root).violations.map((v) => `${v.file}:${v.line} ${v.rule}`).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

describe('check-layers', () => {
  it('passes, with a file count, when the tree is empty', () => {
    const r = checkLayers({ root: tmp('empty-') });
    expect(r.passed).toBe(true);
    expect(r.render()).toMatch(/0 source files/);
  });

  it('passes a well-layered tree', () => {
    const root = tree({
      'src/workshop/sim/index.ts': `export * from './world.ts';\nexport type { Part } from './types.ts';`,
      'src/workshop/sim/types.ts': `export interface Part { id: string }`,
      'src/workshop/sim/world.ts': `import { rng } from './rng.ts';\nimport { step } from './physics/rapier.ts';\nexport const w = { rng, step, label: "Math.random() // not code" };\n// Date.now() in a comment\nconst o = { window: 1, document: 2 };\nconst p = o.window;`,
      'src/workshop/sim/rng.ts': `export function rng(seed: number) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }`,
      'src/workshop/sim/physics/rapier.ts': `import RAPIER from '@dimforge/rapier3d-compat';\nexport const step = () => RAPIER;`,
      'src/workshop/sim/machines/belt/index.ts': `import { roll } from '../shared/roll.ts';\nimport type { Part } from '../../types.ts';\nimport { helper } from './helper.ts';\nexport { roll, helper };`,
      'src/workshop/sim/machines/belt/helper.ts': `export const helper = 1;`,
      'src/workshop/sim/machines/shared/roll.ts': `export const roll = 1;`,
      'src/workshop/sim/machines/index.ts': `export * from './belt/index.ts';\nexport * from './striker.ts';`,
      'src/workshop/sim/machines/striker.ts': `import { roll } from './shared/roll.ts'; export const s = roll;`,
      'src/workshop/view/scene.ts': `import * as THREE from 'three';\nimport { w } from '../sim/index.ts';\nimport type { Part } from '../sim/types.ts';\nimport { kit } from './kit/crate.ts';\nexport { THREE, w, kit };`,
      'src/workshop/ui/strip.ts': `import facts from '../../content/projects.json';\nimport type { Part } from '../sim/types.ts';\nexport const s = facts;`,
      'src/workshop/shell/boot.ts': `const t = setTimeout(() => {}, 0); const n = performance.now(); import('../view/scene.ts');`,
      'src/content/index.ts': `import p from './projects.json';\nexport default p;`,
    });
    expect(rules(root)).toEqual([]);
    expect(checkLayers({ root }).passed).toBe(true);
  });

  it('fails on Math.random and the other clocks in sim, with the reason', () => {
    const root = tree({
      'src/workshop/sim/world.ts': [
        'export const a = Math.random();',
        'export const b = Date.now();',
        'export const c = new Date();',
        'export const d = performance.now();',
        'setTimeout(() => {}, 1);',
        'requestAnimationFrame(() => {});',
        'export const e = window.innerWidth;',
        'document.title = "x";',
        'fetch("/x");',
        'export const f = globalThis.Math["random"];',
        'const g = Math?.random;',
      ].join('\n'),
    });
    expect(rules(root)).toEqual([
      'src/workshop/sim/world.ts:1 no-Math.random',
      'src/workshop/sim/world.ts:2 no-Date.now',
      'src/workshop/sim/world.ts:3 no-new-Date',
      'src/workshop/sim/world.ts:4 no-performance.now',
      'src/workshop/sim/world.ts:5 no-setTimeout',
      'src/workshop/sim/world.ts:6 no-requestAnimationFrame',
      'src/workshop/sim/world.ts:7 no-window',
      'src/workshop/sim/world.ts:8 no-document',
      'src/workshop/sim/world.ts:9 no-fetch',
      'src/workshop/sim/world.ts:10 no-Math.random',
      'src/workshop/sim/world.ts:11 no-Math.random',
    ]);
    const r = checkLayers({ root });
    expect(r.failures[0]).toMatch(/src\/workshop\/sim\/world\.ts:1 no-Math\.random — uses Math\.random: sim is deterministic from a seed/);
  });

  it('fails when sim imports three, a package, an outer layer, astro: or content', () => {
    const root = tree({
      'src/workshop/sim/a.ts': [
        `import * as THREE from 'three';`,
        `import { Vector3 } from 'three/src/math/Vector3.js';`,
        `import type { Mesh } from "three";`,
        `import { pick } from '../input/picking.ts';`,
        `export { label } from '../ui/strip.ts';`,
        `const v = await import('../view/scene.ts');`,
        `import { getCollection } from 'astro:content';`,
        `import facts from '../../content/projects.json';`,
        `import seedrandom from 'seedrandom';`,
        `import RAPIER from '@dimforge/rapier3d';`,
      ].join('\n'),
    });
    expect(rules(root)).toEqual([
      'src/workshop/sim/a.ts:1 sim-no-three',
      'src/workshop/sim/a.ts:2 sim-no-three',
      'src/workshop/sim/a.ts:3 sim-no-three',
      'src/workshop/sim/a.ts:4 sim-no-outer-layers',
      'src/workshop/sim/a.ts:5 sim-no-outer-layers',
      'src/workshop/sim/a.ts:6 sim-no-outer-layers',
      'src/workshop/sim/a.ts:7 sim-no-astro',
      'src/workshop/sim/a.ts:8 sim-no-content',
      'src/workshop/sim/a.ts:9 sim-imports-only-sim',
      'src/workshop/sim/a.ts:10 rapier-only-in-physics',
    ]);
    expect(checkLayers({ root }).failures.join('\n')).toMatch(/sim-no-three — imports "three": sim does not know it is being drawn/);
  });

  it('fails when one machine imports another', () => {
    const root = tree({
      'src/workshop/sim/machines/belt/index.ts': `import { strike } from '../striker/index.ts';\nimport { all } from '../index.ts';`,
      'src/workshop/sim/machines/striker/index.ts': `export const strike = 1;`,
      'src/workshop/sim/machines/dock.ts': `import { strike } from './striker/index.ts';`,
      'src/workshop/sim/machines/index.ts': `export * from './belt/index.ts';`,
    });
    expect(rules(root)).toEqual([
      'src/workshop/sim/machines/belt/index.ts:1 machines-do-not-call-each-other',
      'src/workshop/sim/machines/belt/index.ts:2 machines-do-not-call-each-other',
      'src/workshop/sim/machines/dock.ts:1 machines-do-not-call-each-other',
    ]);
  });

  it('enforces the view, input, audio, ui, shell and content rules', () => {
    const root = tree({
      'src/workshop/view/a.ts': `import { pick } from '../input/pick.ts';\nimport { belt } from '../sim/machines/belt.ts';\nimport { world } from '../sim/world.ts';\nimport { ok } from '../sim/index.ts';`,
      'src/workshop/input/a.ts': `import { belt } from '../sim/machines/belt.ts';\nimport { BeltView } from '../view/stations/belt.ts';\nimport { ok } from '../sim/index.ts';`,
      'src/workshop/audio/a.ts': `import { s } from '../ui/strip.ts';\nimport { t } from '../sim/types.ts';`,
      'src/workshop/ui/a.ts': `import * as THREE from 'three';\nimport { belt } from '../sim/machines/belt.ts';`,
      'src/workshop/shell/a.ts': `import { belt } from '../sim/machines/belt.ts';\nimport { v } from '../view/stations/belt.ts';\nimport { scene } from '../view/scene.ts';`,
      'src/content/a.ts': `import { z } from 'zod';\nimport x from '../workshop/sim/index.ts';\nimport y from './b.json';`,
      'src/workshop/view/rapier.ts': `import R from '@dimforge/rapier3d-compat';`,
    });
    expect(rules(root)).toEqual([
      'src/content/a.ts:1 content-is-self-contained',
      'src/content/a.ts:2 content-is-self-contained',
      'src/workshop/audio/a.ts:1 audio-decides-nothing',
      'src/workshop/input/a.ts:1 input-knows-no-machine',
      'src/workshop/input/a.ts:2 input-knows-no-machine',
      'src/workshop/shell/a.ts:1 shell-knows-no-station',
      'src/workshop/shell/a.ts:2 shell-knows-no-station',
      'src/workshop/ui/a.ts:1 ui-no-three-no-machines',
      'src/workshop/ui/a.ts:2 ui-no-three-no-machines',
      'src/workshop/view/a.ts:1 view-no-input-ui-audio-shell',
      'src/workshop/view/a.ts:2 view-reads-sim-surface-only',
      'src/workshop/view/a.ts:3 view-reads-sim-surface-only',
      'src/workshop/view/rapier.ts:1 rapier-only-in-physics',
    ]);
  });

  it('flags a computed dynamic import in sim', () => {
    const root = tree({ 'src/workshop/sim/a.ts': 'const name = "x"; await import(`./machines/${name}.ts`);' });
    expect(rules(root)).toEqual(['src/workshop/sim/a.ts:1 literal-imports-only']);
  });

  it('reads the frontmatter and scripts of .astro files and resolves tsconfig aliases', () => {
    const root = tree({
      'tsconfig.json': '{ // jsonc\n "compilerOptions": { "baseUrl": ".", "paths": { "@workshop/*": ["src/workshop/*"], }, }, }',
      'src/workshop/sim/a.ts': `import { v } from '@workshop/view/scene.ts';`,
      'src/workshop/ui/Panel.astro': `---\nimport { belt } from '../sim/machines/belt.ts';\n---\n<p>import x from 'three'</p>\n<script>\nimport * as THREE from 'three';\n</script>`,
    });
    expect(rules(root)).toEqual([
      'src/workshop/sim/a.ts:1 sim-no-outer-layers',
      'src/workshop/ui/Panel.astro:2 ui-no-three-no-machines',
      'src/workshop/ui/Panel.astro:6 ui-no-three-no-machines',
    ]);
  });

  it('names the machine of a path', () => {
    expect(machineOf('src/workshop/sim/machines/belt/x.ts')).toBe('belt');
    expect(machineOf('src/workshop/sim/machines/belt.ts')).toBe('belt');
    expect(machineOf('src/workshop/sim/world.ts')).toBeNull();
  });
});

describe('tokenizer', () => {
  it('is not fooled by strings, comments, templates and regexes', () => {
    const src = [
      `const a = "import x from 'three'"; // import y from 'three'`,
      `/* import z from 'three' */`,
      'const t = `import q from ${"three"} and ${ {a: 1}.a }`;',
      `const r = /import\\s+from 'three'/g;`,
      `const d = 4 / 2 / 1;`,
      `export * as ns from './ns.ts';`,
      `export { a, b as c } from "./ab.ts";`,
      `import def, { x } from './real.ts';`,
      `import './side-effect.css';`,
      `const m = import.meta.url;`,
      `const lazy = import('./lazy.ts');`,
    ].join('\n');
    const imps = findImports(tokenize(src)).map((i) => `${i.line}:${i.kind}:${i.specifier}`);
    expect(imps).toEqual([
      '6:reexport:./ns.ts',
      '7:reexport:./ab.ts',
      '8:static:./real.ts',
      '9:static:./side-effect.css',
      '11:dynamic:./lazy.ts',
    ]);
  });
});
