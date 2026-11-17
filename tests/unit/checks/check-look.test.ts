import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { checkLook, lookViolations } from '../../../scripts/check-look.ts';
import { tmp, write } from './helpers.ts';

const rulesOf = (path: string, code: string): string[] => lookViolations(path, code).map((v) => `${v.line} ${v.rule.split(':')[0]}`);

describe('check-look', () => {
  it('passes, with a count, when nothing exists yet', () => {
    const r = checkLook({ root: tmp('look-') });
    expect(r.passed).toBe(true);
    expect(r.render()).toMatch(/0 source files/);
  });

  it('fails new BoxGeometry outside the kit and passes it inside', () => {
    const code = `import * as THREE from 'three';\nconst g = new THREE.BoxGeometry(1, 1, 1);\nconst m = new Mesh(g, mat);\nconst i = new InstancedMesh(g, mat, 10);\nconst l = new LineSegments(g);\nconst p = new Points(g);\nconst b = new BufferGeometry();\nclass Crate extends THREE.Mesh {}`;
    expect(rulesOf('src/workshop/view/stations/belt.ts', code)).toEqual([
      '2 mesh-from-kit', '3 mesh-from-kit', '4 mesh-from-kit', '5 mesh-from-kit', '6 mesh-from-kit', '7 mesh-from-kit', '8 mesh-from-kit',
    ]);
    expect(rulesOf('src/workshop/view/kit/crate.ts', code)).toEqual([]);
  });

  it('fails new …Material outside materials/, not Line3 or LineBasicMaterial as geometry', () => {
    const code = `const a = new THREE.MeshStandardMaterial({ roughness: 0.5 });\nconst b = new ShaderMaterial({});\nconst c = new LineBasicMaterial();\nconst d = new Line3();`;
    expect(rulesOf('src/workshop/view/kit/crate.ts', code)).toEqual(['1 material-from-materials', '2 material-from-materials', '3 material-from-materials']);
    expect(rulesOf('src/workshop/view/materials/paint.ts', code)).toEqual([]);
  });

  it('fails a hex colour outside the palette, in every form', () => {
    const code = [
      `const a = '#ff8800';`,
      `const b = new Color(0xff8800);`,
      `const c = { color: 0x112233, roughness: 1 };`,
      `mat.emissive.setHex(0xabcdef);`,
      `const d = new THREE.Color('tomato');`,
      `const e = "rgb(255, 0, 0)";`,
      `const f = new DirectionalLight(0xffffff, 2);`,
      `c.setRGB(1, 0.5, 0);`,
      `c.setHSL(0.1, 0.5, 0.5);`,
      `const g = new Color(1, 0, 0);`,
      `x.color = '#abc';`,
      'const h = `background: #102030`;',
    ].join('\n');
    expect(rulesOf('src/workshop/view/stations/belt.ts', code)).toEqual([
      '1 colour-in-palette', '2 colour-in-palette', '3 colour-in-palette', '4 colour-in-palette', '5 colour-in-palette', '6 colour-in-palette',
      '7 colour-in-palette', '8 colour-in-palette', '9 colour-in-palette', '10 colour-in-palette', '11 colour-in-palette', '12 colour-in-palette',
    ]);
    expect(rulesOf('src/workshop/view/palette.ts', code)).toEqual([]);
  });

  it('allows colours derived from tokens, plain numbers, URLs with fragments and GLSL', () => {
    const code = [
      `import { palette } from '../palette.ts';`,
      `const a = palette.brass.clone().lerp(palette.lamp, 0.3);`,
      `const b = palette.paint.clone().offsetHSL(0, 0, 0.1).multiplyScalar(0.8);`,
      `const c = new Color(palette.ink);`,
      `const d = { color: palette.red, roughness: 0.4, size: 0x10 };`,
      `const e = '/resume/#about';`,
      `const f = '#add';`.replace('#add', '#a'),
      'const shader = `#define PI 3.14\\n#include <common>\\nvoid main(){ vec3 col = vec3(1.0, 0.5, 0.0); gl_FragColor = vec4(col, 1.0); }`;',
      `// const g = '#ff0000'; new BoxGeometry()`,
      `light.intensity = 2; mesh.position.set(0, 1, 0);`,
    ].join('\n');
    expect(rulesOf('src/workshop/view/stations/belt.ts', code)).toEqual([]);
  });

  it('scans dev pages and prints file:line rule — excerpt', () => {
    const root = tmp('look-');
    write(join(root, 'src/dev-pages/catalogue.astro'), `---\nconst bg = '#000000';\n---\n<div style="color: #fff">x</div>\n<script>\nimport { BoxGeometry } from 'three';\nnew BoxGeometry();\n</script>`);
    write(join(root, 'src/workshop/view/palette.ts'), `export const ink = '#101828';`);
    const r = checkLook({ root });
    expect(r.failures).toEqual([
      `src/dev-pages/catalogue.astro:2 colour-in-palette: colour string literal outside src/workshop/view/palette.ts — const bg = '#000000';`,
      `src/dev-pages/catalogue.astro:7 mesh-from-kit: new BoxGeometry() outside src/workshop/view/kit — new BoxGeometry();`,
    ]);
  });
});
