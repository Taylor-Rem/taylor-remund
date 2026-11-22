// The paint scheme (D2) without a GPU: one set of uniforms repaints the steel enamel by its hue, the approved look
// is untouched at home (the block switched off, every multiplier exactly one), a scheme is never a define (no new
// program), the wipe runs and ends, and what keeps its own colours shares the program.
import { BoxGeometry, Color, Group, Mesh, ShaderLib, UniformsUtils, type MeshPhysicalMaterial, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import { createMaterials } from '../../../src/workshop/view/materials/index.ts';
import { HOME_SCHEME, S_MATCH, SCHEME_IDS, SCHEME_LOOK, SCHEME_SLOTS, SCHEMES, SchemeState, schemeUniforms, slotColour, slotMultiplier, slotOf } from '../../../src/workshop/view/materials/scheme.ts';
import { linear, linearScheme, palette, schemeColours, type SchemeColour, type Token } from '../../../src/workshop/view/palette.ts';

function compile(m: MeshPhysicalMaterial): WebGLProgramParametersWithUniforms {
  const shader = {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms),
  } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, undefined as never);
  return shader;
}

const TOKENS = Object.keys(palette) as Token[];

describe('the paint scheme', () => {
  it('A is the approved look: it repaints nothing, every multiplier exactly one', () => {
    expect(HOME_SCHEME).toBe('A');
    expect(SCHEMES.A).toEqual({});
    for (const slot of SCHEME_SLOTS) expect(slotMultiplier('A', slot)).toEqual([1, 1, 1]);
  });

  it('tells each slot by its hue, whatever its shade, and no other palette colour as one', () => {
    SCHEME_SLOTS.forEach((slot, i) => {
      for (const shade of [0.3, 0.8, 1, 1.15, 1.6]) expect(slotOf(linear(slot).map((c) => c * shade) as [number, number, number])).toBe(i);
    });
    for (const t of TOKENS) if (!(SCHEME_SLOTS as readonly string[]).includes(t)) expect(slotOf(linear(t)), t).toBe(-1);
    // the slots are far apart (in hue) compared with the match radius
    for (let a = 0; a < SCHEME_SLOTS.length; a++) for (let b = a + 1; b < SCHEME_SLOTS.length; b++) {
      const ha = linear(SCHEME_SLOTS[a]!), hb = linear(SCHEME_SLOTS[b]!);
      const na = ha.map((x) => x / Math.max(...ha)), nb = hb.map((x) => x / Math.max(...hb));
      const d = na.reduce((s, x, k) => s + (x - nb[k]!) ** 2, 0);
      expect(d).toBeGreaterThan(S_MATCH * 20);
    }
  });

  it('paints each slot its scheme colour: the shade survives the repaint', () => {
    for (const id of SCHEME_IDS) for (const slot of SCHEME_SLOTS) {
      const m = slotMultiplier(id, slot), h = linear(slot), want = slotColour(id, slot);
      for (let k = 0; k < 3; k++) expect(h[k]! * 0.8 * m[k]!).toBeCloseTo(want[k]! * 0.8, 9);
    }
    // every scheme colour is used by a scheme, and lives in the palette file
    const used = new Set<string>(SCHEME_IDS.flatMap((id) => Object.values(SCHEMES[id] as Record<string, string>)));
    for (const k of Object.keys(schemeColours) as SchemeColour[]) {
      expect(used.has(k), k).toBe(true);
      expect(linearScheme(k).every((x) => x >= 0 && x <= 1)).toBe(true);
    }
  });

  it('starts at home with the block switched off; a cut switches it on and back off', () => {
    const u = schemeUniforms();
    const s = new SchemeState(u);
    expect(u['s_active']!.value).toBe(0);
    s.set('B');
    expect(u['s_active']!.value).toBe(1);
    expect(u['s_radius']!.value).toBe(1e6);
    expect((u['s_to0']!.value as Color).toArray()).toEqual(slotMultiplier('B', 'teal-panel'));
    s.set('A');
    expect(u['s_active']!.value).toBe(0);
    for (let i = 0; i < SCHEME_SLOTS.length; i++) expect((u[`s_to${i}`]!.value as Color).toArray()).toEqual([1, 1, 1]);
  });

  it('wipes out from the origin at the set speed, then rests on the new scheme; reduced motion cuts', () => {
    const u = schemeUniforms();
    const s = new SchemeState(u);
    s.set('C', { time: 10, origin: [1, 2, 3] });
    expect(u['s_active']!.value).toBe(1);
    expect(u['s_radius']!.value).toBe(0);
    expect((u['s_from0']!.value as Color).toArray()).toEqual([1, 1, 1]);
    expect(s.update(10.5)).toBe(true);
    expect(u['s_radius']!.value).toBeCloseTo(0.5 * SCHEME_LOOK.speed, 9);
    expect(s.update(10 + SCHEME_LOOK.reach / SCHEME_LOOK.speed + 0.01)).toBe(false);
    expect(s.from).toBe('C');
    expect(u['s_radius']!.value).toBe(1e6);
    // back home with a wipe: on while it runs, off when it is done
    s.set('A', { time: 20 });
    expect(u['s_active']!.value).toBe(1);
    s.update(40);
    expect(u['s_active']!.value).toBe(0);
    s.set('D', { time: 50, reduced: true });
    expect(u['s_radius']!.value).toBe(1e6);
    expect(s.update(50.1)).toBe(false);
  });
});

describe('the steel material and the scheme', () => {
  const mats = createMaterials({ tier: 'high' });
  const steel = mats.of('steel') as MeshPhysicalMaterial;

  it('repaints in the steel class block, before anything reads the base colour', () => {
    const fs = compile(steel).fragmentShader;
    const at = fs.indexOf('if (s_active * s_on > 0.5)');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(fs.indexOf('vec3 paint = pBase'));
    expect(fs).toContain('uniform float s_active;');
    expect(fs).toContain('uniform vec3 s_origin;');
    for (let i = 0; i < SCHEME_SLOTS.length; i++) expect(fs).toContain(`uniform vec3 s_to${i};`);
    // no other class takes it
    for (const cls of ['brass', 'wood', 'tape', 'felt'] as const) expect(compile(mats.of(cls) as MeshPhysicalMaterial).fragmentShader).not.toContain('s_active');
  });

  it('is a uniform, never a define: a scheme change leaves the program key and the defines alone', () => {
    const key = steel.customProgramCacheKey();
    const defines = JSON.stringify(steel.defines);
    for (const id of SCHEME_IDS) {
      mats.paint.set(id);
      expect(steel.customProgramCacheKey()).toBe(key);
      expect(JSON.stringify(steel.defines)).toBe(defines);
    }
    mats.paint.set('A');
  });

  it('keeps the colours of what is given to keepColours: a twin with the same program and class uniforms, switched off', () => {
    const g = new Group();
    const a = new Mesh(new BoxGeometry(), steel);
    const b = new Mesh(new BoxGeometry(), mats.of('brass'));
    g.add(a, b);
    expect(mats.keepColours(g)).toBe(1);
    const twin = a.material as MeshPhysicalMaterial;
    expect(twin).not.toBe(steel);
    expect(b.material).toBe(mats.of('brass'));
    expect(twin.customProgramCacheKey()).toBe(steel.customProgramCacheKey());
    const su = compile(steel).uniforms, tu = compile(twin).uniforms;
    expect(su['s_on']!.value).toBe(1);
    expect(tu['s_on']!.value).toBe(0);
    expect(tu['u_roughness']).toBe(su['u_roughness']);
    expect(tu['s_active']).toBe(su['s_active']);
    // the same twin for every mesh of that material; twice is harmless
    const c = new Mesh(new BoxGeometry(), steel);
    g.add(c);
    mats.keepColours(g);
    expect(c.material).toBe(twin);
    expect(a.material).toBe(twin);
    expect(mats.all()).toContain(twin);
  });
});
