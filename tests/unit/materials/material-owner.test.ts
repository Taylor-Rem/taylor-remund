// D2c: one owner of a kept or fading mesh's material. The paint scheme (keepColours twins, drawn while a scheme
// repaints) and the crates' see-through (a fade on a body in the way of a look) both change what a crew member or a
// loose part draws with; the materials module works it out from both. Every order of fade, un-fade, a scheme, another
// scheme and home leaves, at every step, the material and renderOrder the facts call for, and ends (un-faded, at home)
// on the identical instances the meshes started with. (Before D2c, 22 of the orders up to three long were wrong: a
// scheme begun while faded dropped the fade; an un-fade while a scheme was shown repainted the crew; and a fade begun
// while a scheme was shown then ended at home left the keep twin on for good.)
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Material, type MeshPhysicalMaterial, type WebGLProgramParametersWithUniforms, ShaderLib, UniformsUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { createMaterials } from '../../../src/workshop/view/materials/index.ts';

type Ev = 'fade' | 'unfade' | 'B' | 'C' | 'home';
const EVENTS: Ev[] = ['fade', 'unfade', 'B', 'C', 'home'];

function compile(m: Material): WebGLProgramParametersWithUniforms {
  const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms) } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, undefined as never);
  return shader;
}

/** Run `seq` on a fresh rig; null when every step and the end were right, else what went wrong first. */
function walk(seq: Ev[]): string | null {
  const mats = createMaterials({ tier: 'high' });
  const steel = mats.of('steel');
  const brass = mats.of('brass');
  const foreign = new MeshBasicMaterial();
  const body = new Group();
  const a = new Mesh(new BoxGeometry(), steel); // kept: has a keep twin
  const b = new Mesh(new BoxGeometry(), brass); // never repainted: no twin, but fades
  const c = new Mesh(new BoxGeometry(), foreign); // not ours: no twin, no ghost
  a.renderOrder = 3;
  body.add(a, b, c);
  mats.keepColours(body);
  // the twin, found by showing a scheme once (and back home)
  mats.paint.set('B');
  const twin = a.material as Material;
  mats.paint.set('A');
  if (a.material !== steel) return 'home after the first scheme: not its own material';
  const fade = { value: 0.5 };
  let faded = false;
  let active = false;
  const check = (where: string): string | null => {
    const baseA: Material = active ? twin : steel;
    const wantA = faded ? mats.seeThrough(baseA, fade)! : baseA;
    const wantB = faded ? mats.seeThrough(brass, fade)! : brass;
    if (a.material !== wantA) return `${where}: kept mesh on ${(a.material as Material).name}, want ${wantA.name}`;
    if (b.material !== wantB) return `${where}: brass mesh on ${(b.material as Material).name}, want ${wantB.name}`;
    if (c.material !== foreign) return `${where}: a foreign material was replaced`;
    if (a.renderOrder !== (active ? -1 : 3)) return `${where}: kept mesh renderOrder ${a.renderOrder}`;
    if (b.renderOrder !== 0 || c.renderOrder !== 0) return `${where}: a renderOrder moved that should not`;
    return null;
  };
  for (let i = 0; i < seq.length; i++) {
    const e = seq[i]!;
    if (e === 'fade') {
      mats.fade(body, fade);
      faded = true;
    } else if (e === 'unfade') {
      mats.fade(body, null);
      faded = false;
    } else {
      mats.paint.set(e === 'home' ? 'A' : e);
      active = e !== 'home';
    }
    const bad = check(seq.slice(0, i + 1).join(' > '));
    if (bad) return bad;
  }
  // the end: un-faded, home: the very instances it started with
  mats.fade(body, null);
  mats.paint.set('A');
  if (a.material !== steel || b.material !== brass || c.material !== foreign) return `${seq.join(' > ')} then un-fade, home: not the original instances`;
  if (a.renderOrder !== 3 || b.renderOrder !== 0 || c.renderOrder !== 0) return `${seq.join(' > ')} then un-fade, home: renderOrder not restored`;
  return null;
}

describe('one owner of a mesh\'s material (paint scheme × see-through)', () => {
  it('every order of up to four of fade, un-fade, scheme B, scheme C and home is right at every step and ends on the original instances', () => {
    const bad: string[] = [];
    let n = 0;
    const all = (left: number, pre: Ev[]): void => {
      if (pre.length) {
        n++;
        const r = walk(pre);
        if (r) bad.push(r);
      }
      if (left === 0) return;
      for (const e of EVENTS) all(left - 1, [...pre, e]);
    };
    all(4, []);
    expect(n).toBe(5 + 25 + 125 + 625);
    expect(bad).toEqual([]);
  });

  it('(D2d) a kept loose part that fades (a crate a crew member carries: wood, steel, paper) is right at every step of every order of up to four of fade, un-fade, B, C and home, and ends on its own instances', () => {
    const bad: string[] = [];
    let n = 0;
    const run = (seq: Ev[]): void => {
      n++;
      const mats = createMaterials({ tier: 'high' });
      const own = (['wood', 'steel', 'paper'] as const).map((c) => mats.of(c));
      const body = new Group();
      const meshes = own.map((m) => new Mesh(new BoxGeometry(), m));
      body.add(...meshes);
      mats.keepColours(body);
      mats.paint.set('B');
      const twin = meshes[1]!.material as Material;
      mats.paint.set('A');
      const fade = { value: 0.5 };
      let faded = false;
      let shown = false;
      for (let i = 0; i < seq.length; i++) {
        const e = seq[i]!;
        if (e === 'fade' || e === 'unfade') {
          faded = e === 'fade';
          mats.fade(body, faded ? fade : null);
        } else {
          shown = e !== 'home';
          mats.paint.set(e === 'home' ? 'A' : e);
        }
        const want = own.map((m, k) => {
          const base = k === 1 && shown ? twin : m;
          return faded ? mats.seeThrough(base, fade)! : base;
        });
        meshes.forEach((m, k) => {
          if (m.material !== want[k]) bad.push(`${seq.slice(0, i + 1).join(' > ')}: ${own[k]!.name} on ${(m.material as Material).name}`);
        });
        if (meshes[1]!.renderOrder !== (shown ? -1 : 0)) bad.push(`${seq.slice(0, i + 1).join(' > ')}: the kept steel's renderOrder ${meshes[1]!.renderOrder}`);
      }
      mats.fade(body, null);
      mats.paint.set('A');
      if (meshes.some((m, k) => m.material !== own[k] || m.renderOrder !== 0)) bad.push(`${seq.join(' > ')} then un-fade, home: not its own instances`);
    };
    const all = (left: number, pre: Ev[]): void => {
      if (pre.length) run(pre);
      if (left > 0) for (const e of EVENTS) all(left - 1, [...pre, e]);
    };
    all(4, []);
    expect(n).toBe(780);
    expect(bad).toEqual([]);
  });

  it('a kept loose part that never fades (the report press: enamel, brass, wood, paper) swaps with every order of up to four of B, C and home, and ends on its own instances', () => {
    // (the press's view calls keepColours on its piece; the piece itself needs the label atlas, a canvas, so it is
    // stood in for by its four classes)
    const S: Array<'B' | 'C' | 'A'> = ['B', 'C', 'A'];
    const bad: string[] = [];
    let n = 0;
    const run = (seq: Array<'B' | 'C' | 'A'>): void => {
      n++;
      const mats = createMaterials({ tier: 'high' });
      const own = (['steel', 'brass', 'wood', 'paper'] as const).map((c) => mats.of(c));
      const body = new Group();
      const meshes = own.map((m) => new Mesh(new BoxGeometry(), m));
      body.add(...meshes);
      mats.keepColours(body);
      for (let i = 0; i < seq.length; i++) {
        mats.paint.set(seq[i]!);
        const shown = seq[i] !== 'A';
        // the enamel is on its keep twin (s_on 0, drawn first) while a scheme shows; the others never change
        const m0 = meshes[0]!.material as Material;
        if (shown && (m0 === own[0] || !m0.name.endsWith('own-colours') || meshes[0]!.renderOrder !== -1)) bad.push(`${seq.slice(0, i + 1).join(' > ')}: the enamel is not on its own colours`);
        if (!shown && (m0 !== own[0] || meshes[0]!.renderOrder !== 0)) bad.push(`${seq.slice(0, i + 1).join(' > ')}: home, not its own material`);
        for (let k = 1; k < 4; k++) if (meshes[k]!.material !== own[k] || meshes[k]!.renderOrder !== 0) bad.push(`${seq.slice(0, i + 1).join(' > ')}: a ${own[k]!.name} mesh changed`);
      }
      mats.paint.set('A');
      if (meshes.some((m, k) => m.material !== own[k] || m.renderOrder !== 0)) bad.push(`${seq.join(' > ')} then home: not its own instances`);
    };
    const all = (left: number, pre: Array<'B' | 'C' | 'A'>): void => {
      if (pre.length) run(pre);
      if (left > 0) for (const s of S) all(left - 1, [...pre, s]);
    };
    all(4, []);
    expect(n).toBe(3 + 9 + 27 + 81);
    expect(bad).toEqual([]);
  });

  it('a ghost of a keep twin keeps s_on 0 (the crew stay in their own colours while see-through under a scheme)', () => {
    const mats = createMaterials({ tier: 'high' });
    const steel = mats.of('steel');
    const body = new Group();
    const a = new Mesh(new BoxGeometry(), steel);
    body.add(a);
    mats.keepColours(body);
    mats.paint.set('B');
    const fade = { value: 0.75 };
    mats.fade(body, fade);
    const ghost = a.material as MeshPhysicalMaterial;
    expect(ghost.name).toBe('workshop/steel/own-colours/see-through');
    expect(compile(ghost).uniforms['s_on']!.value).toBe(0);
    expect(compile(ghost).uniforms['u_fade']).toBe(fade);
    expect(ghost.customProgramCacheKey()).toBe(`${steel.customProgramCacheKey()}ghost`);
  });

  it('prepareFade compiles the ghosts on the meshes themselves and gives the meshes straight back what they had', async () => {
    const mats = createMaterials({ tier: 'high' });
    const steel = mats.of('steel');
    const body = new Group();
    const a = new Mesh(new BoxGeometry(), steel);
    body.add(a);
    mats.keepColours(body);
    const fade = { value: 0 };
    const seen: Material[] = [];
    const n = await mats.prepareFade(body, fade, async (o) => {
      o.traverse((x) => { if ((x as Mesh).isMesh) seen.push((x as Mesh).material as Material); });
      return 1;
    });
    expect(n).toBe(1);
    expect(seen).toEqual([mats.seeThrough(steel, fade)]);
    expect(a.material).toBe(steel);
    // the twin's ghost was made too (the same program): a fade under a scheme builds nothing new
    mats.paint.set('B');
    mats.fade(body, fade);
    expect((a.material as Material).name).toBe('workshop/steel/own-colours/see-through');
    mats.fade(body, null);
    mats.paint.set('A');
    expect(a.material).toBe(steel);
  });

  it('a mesh nobody keeps or fades is not held (no growing table)', () => {
    const mats = createMaterials({ tier: 'high' });
    const body = new Group();
    const a = new Mesh(new BoxGeometry(), mats.of('brass'));
    body.add(a);
    mats.fade(body, { value: 0.5 });
    mats.fade(body, null);
    expect(a.material).toBe(mats.of('brass'));
    mats.fade(body, null); // twice is harmless
    expect(a.material).toBe(mats.of('brass'));
  });
});
