// view/materials without a GPU: every class exists and is wired the same way,
// textured variants cache, parameters are live uniforms, update() drives the
// belt and the bulbs, the shader injection finds every chunk it needs in
// three's real sources, and no colour literal lives in the folder.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, ShaderLib, Texture, UniformsUtils, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import { lookViolations } from '../../../scripts/check-look.ts';
import { CLASS_NAMES, CLASSES, createMaterials, DEBUG_VIEWS } from '../../../src/workshop/view/materials/index.ts';
import { bakeNoise, NOISE_SIZE } from '../../../src/workshop/view/materials/noise.ts';
import type { MaterialClass } from '../../../src/workshop/view/kit/types.ts';
import type { Labels } from '../../../src/workshop/view/types.ts';

const ALL: MaterialClass[] = ['steel', 'brass', 'wood', 'rubber', 'paper', 'metal', 'glass', 'bulb', 'felt', 'tape', 'belt'];

/**
 * A stand-in for view/labels (no browser here: the real createLabels needs
 * fonts and a canvas; the dev page uses the real one). Keys follow the real
 * `register|text` shape; tape and stencils are transparent, plates carry a
 * roughness map.
 */
function fakeLabels(): Labels & { made: string[] } {
  const made: string[] = [];
  const tex = new Map<string, Texture>();
  const rough = new Map<string, Texture>();
  const key = (register: string) => (t: string): string => {
    const k = `${register}|${t}`;
    if (!tex.has(k)) {
      tex.set(k, new Texture());
      if (register === 'plate') rough.set(k, new Texture());
      made.push(k);
    }
    return k;
  };
  return {
    made,
    tape: key('tape:black'), stencil: key('stencil:ink'), card: key('card'), plate: key('plate'), sign: key('sign'), slip: key('slip'),
    phone: (m) => key('phone')(m.map((x) => x.text).join(' ')),
    size: () => ({ w: 1, h: 0.2 }),
    capHeight: () => 0.2,
    texture: (k) => tex.get(k)!,
    normalMap: () => null,
    roughnessMap: (k) => rough.get(k) ?? null,
    transparent: (k) => k.startsWith('tape') || k.startsWith('stencil') || k.startsWith('slip'),
  };
}

/** Run a material's onBeforeCompile over three's real physical shader, as the renderer would. */
function compile(m: MeshStandardMaterial): WebGLProgramParametersWithUniforms {
  const shader = {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms),
  } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, undefined as never);
  return shader;
}

describe('materials', () => {
  const mats = createMaterials({ tier: 'high' });

  it('has exactly the classes of MaterialClass', () => {
    expect([...CLASS_NAMES].sort()).toEqual([...ALL].sort());
  });

  it('returns one shared PBR material per class, vertex-coloured', () => {
    for (const cls of ALL) {
      const m = mats.of(cls);
      expect(m).toBeInstanceOf(MeshStandardMaterial);
      expect(m).toBe(mats.of(cls));
      expect((m as MeshStandardMaterial).vertexColors).toBe(true);
      if (CLASSES[cls].kind === 'physical') expect(m).toBeInstanceOf(MeshPhysicalMaterial);
    }
    expect(new Set(ALL.map((c) => mats.of(c))).size).toBe(ALL.length);
  });

  it('gives every class and tier its own program cache key', () => {
    const low = createMaterials({ tier: 'low' });
    const keys = [...ALL.map((c) => mats.of(c).customProgramCacheKey()), ...ALL.map((c) => low.of(c).customProgramCacheKey())];
    expect(new Set(keys).size).toBe(keys.length);
    expect((low.of('steel') as MeshStandardMaterial).defines?.TIER_LOW).toBe('');
    low.dispose();
  });

  it('injects into every shader chunk it needs, for every class', () => {
    for (const cls of ALL) {
      const s = compile(mats.of(cls) as MeshStandardMaterial);
      expect(s.vertexShader).toContain('attribute vec3 surf;');
      expect(s.vertexShader).toContain('vLp = ');
      expect(s.fragmentShader).toContain('uniform highp sampler3D uNoiseTex;');
      expect(s.fragmentShader).toContain('roughnessFactor = clamp(pRough');
      expect(s.fragmentShader).toContain('normal = pPerturb(');
      expect(s.fragmentShader).not.toContain('#include <color_fragment>');
      for (const name of Object.keys(CLASSES[cls].params)) {
        expect(s.uniforms[`u_${name}`], `${cls}.${name}`).toBeDefined();
        expect(s.fragmentShader).toContain(`uniform float u_${name};`);
      }
      expect(s.uniforms.uNoiseTex).toBeDefined();
    }
  });

  it('keeps every parameter inside its declared range', () => {
    for (const cls of ALL) {
      for (const [name, prm] of Object.entries(CLASSES[cls].params)) {
        expect(prm.min, `${cls}.${name}`).toBeLessThanOrEqual(prm.value);
        expect(prm.value, `${cls}.${name}`).toBeLessThanOrEqual(prm.max);
      }
    }
  });

  it('sets parameters live and clamps them', () => {
    const m = createMaterials({ tier: 'high' });
    m.set('steel', 'chipAmount', 99);
    expect(m.uniforms('steel').u_chipAmount!.value).toBe(CLASSES.steel.params.chipAmount!.max);
    expect(() => m.set('steel', 'nope', 1)).toThrow();
    m.dispose();
  });

  it('caches textured variants by class and key, sharing the class uniforms', () => {
    const labels = fakeLabels();
    const m = createMaterials({ tier: 'high' });
    expect(() => m.textured('tape', 'x')).toThrow(/Labels/);
    m.setLabels(labels);
    const k = labels.tape('DO NOT TOUCH');
    const a = m.textured('tape', k);
    expect(m.textured('tape', k)).toBe(a);
    expect(m.textured('tape', labels.tape('OTHER'))).not.toBe(a);
    expect(m.textured('paper', k)).not.toBe(a);
    expect((a as MeshStandardMaterial).map).toBe(labels.texture(k));
    expect((a as MeshStandardMaterial).defines?.LABEL_MAP).toBe('');
    expect(a.customProgramCacheKey()).not.toBe(m.of('tape').customProgramCacheKey());
    expect(compile(a as MeshStandardMaterial).uniforms.u_edgeScuff).toBe(m.uniforms('tape').u_edgeScuff);
    m.dispose();
  });

  it('cuts shaped labels, sprays stencils on, and reads label roughness maps', () => {
    const labels = fakeLabels();
    const m = createMaterials({ tier: 'high', labels });
    const tape = m.textured('tape', labels.tape('X')) as MeshStandardMaterial;
    expect(tape.alphaTest).toBe(0.5);
    expect(tape.transparent).toBe(false);
    const st = m.textured('wood', labels.stencil('M')) as MeshStandardMaterial;
    expect(st.transparent).toBe(true);
    expect(st.depthWrite).toBe(false);
    expect(st.alphaTest).toBe(0);
    expect(st.defines?.LABEL_SPRAY).toBe('');
    const card = m.textured('paper', labels.card('C')) as MeshStandardMaterial;
    expect(card.transparent).toBe(false);
    expect(card.alphaTest).toBe(0);
    const plate = m.textured('brass', labels.plate('P')) as MeshStandardMaterial;
    expect(plate.roughnessMap).toBe(labels.roughnessMap(labels.plate('P')));
    expect(plate.metalnessMap).toBe(plate.roughnessMap);
    const fs = compile(plate).fragmentShader;
    expect(fs).toContain('texelRoughness.g + (pRough - roughness)');
    expect(fs).toContain('texelMetalness.b + (pMetal - metalness)');
    m.dispose();
  });

  it('reads surf as vec3 and lpos, both defaulting to zero when a geometry lacks them', () => {
    for (const cls of ALL) {
      const mat = mats.of(cls) as MeshStandardMaterial & { defaultAttributeValues: Record<string, number[]> };
      expect(mat.defaultAttributeValues.surf).toEqual([0, 0, 0]);
      expect(mat.defaultAttributeValues.lpos).toEqual([0, 0, 0]);
      const s = compile(mat);
      expect(s.vertexShader).toContain('attribute vec3 surf;');
      expect(s.vertexShader).toContain('attribute vec3 lpos;');
      expect(s.vertexShader).toContain('all(equal(lpos, vec3(0.0))) ? position : lpos');
      expect(s.fragmentShader).toContain('float pFinish = clamp(vSurf.z, 0.0, 1.0);');
    }
  });

  it('gives steel a per-pixel clearcoat for finish 1 and wood a cheap large path', () => {
    const steel = mats.of('steel');
    expect(steel).toBeInstanceOf(MeshPhysicalMaterial);
    expect((steel as MeshPhysicalMaterial).clearcoat).toBeGreaterThan(0);
    const fs = compile(steel as MeshStandardMaterial).fragmentShader;
    expect(fs).toContain('float steelChipField(');
    expect(fs).toContain('material.clearcoat = clamp(pCoat, 0.0, 1.0);');
    const large = mats.of('wood', 'large') as MeshStandardMaterial;
    expect(large).not.toBe(mats.of('wood'));
    expect(mats.of('wood', 'large')).toBe(large);
    expect(large.defines?.LARGE).toBe('');
    expect(large.customProgramCacheKey()).not.toBe(mats.of('wood').customProgramCacheKey());
    expect(mats.of('steel', 'large')).toBe(steel); // no large path: the normal material
  });

  it('builds review views: clay and per-pixel signals, own program keys, token colours', () => {
    for (const view of DEBUG_VIEWS) {
      const d = createMaterials({ tier: 'high', debug: view });
      expect(d.debug).toBe(view);
      const m = d.of('steel') as MeshStandardMaterial;
      expect(m.defines?.DEBUG_VIEW).toBe('');
      expect(m.defines?.[`DEBUG_${view.toUpperCase()}`]).toBe('');
      expect(m.customProgramCacheKey()).not.toBe(mats.of('steel').customProgramCacheKey());
      const s = compile(m);
      expect(s.fragmentShader).toContain('uniform vec3 d_clay;');
      expect(s.uniforms.d_clay).toBeDefined();
      expect(s.fragmentShader).toContain('pEmit = vec3(0.0);');
      d.dispose();
    }
    expect(mats.debug).toBeUndefined();
  });

  it('makes the blob-shadow decal: soft radial falloff, no depth write, polygon offset, shared', () => {
    const d = mats.decal();
    expect(d).toBeInstanceOf(MeshBasicMaterial);
    expect(mats.decal()).toBe(d);
    expect(d.transparent).toBe(true);
    expect(d.depthWrite).toBe(false);
    expect(d.depthTest).toBe(true);
    expect(d.polygonOffset).toBe(true);
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: UniformsUtils.clone(ShaderLib.basic.uniforms) } as unknown as WebGLProgramParametersWithUniforms;
    d.onBeforeCompile(shader, undefined as never);
    expect(shader.fragmentShader).toContain('exp(-3.2 * r * r)');
    expect(shader.fragmentShader).toContain('diffuseColor.a *= vColor.r;');
  });

  it('names the bulb levels and picks them by finish', () => {
    const u = mats.uniforms('bulb');
    // bloom threshold 4.5 (knee 0.5): a lamp is far over, an indicator just over in its hot centre
    expect(u.u_lampLevel!.value as number).toBeGreaterThan(10);
    expect(u.u_indicatorLevel!.value as number).toBeGreaterThan(4.5);
    expect(u.u_indicatorLevel!.value as number).toBeLessThan(9);
    expect(compile(mats.of('bulb') as MeshStandardMaterial).fragmentShader).toContain('mix(u_lampLevel, u_indicatorLevel, pFinish)');
  });

  it('gates steel chips by edge response, cavity and a cover cap', () => {
    for (const k of ['wearFloor', 'wearFull', 'maxCover', 'cavityGuard', 'scratchEdge', 'scratchLift']) expect(CLASSES.steel.params[k], k).toBeDefined();
    const fs = compile(mats.of('steel') as MeshStandardMaterial).fragmentShader;
    expect(fs).toContain('float E = steelEdge(pWear);');
    expect(fs).toContain('u_cavityGuard');
    expect(fs).toContain('u_maxCover');
  });

  it('clamps brass and bare-steel glints below the bloom knee, and nothing else', () => {
    for (const cls of ALL) {
      const m = mats.of(cls) as MeshStandardMaterial;
      const clamped = cls === 'brass' || cls === 'metal';
      expect(m.defines?.CLAMP_GLINT !== undefined, cls).toBe(clamped);
      if (clamped) expect(mats.uniforms(cls).u_glintMax!.value as number).toBeLessThan(4.0);
    }
    expect(compile(mats.of('brass') as MeshStandardMaterial).fragmentShader).toContain('outgoingLight *= u_glintMax / mx;');
  });

  it('paints wood by the finish channel without reading the paint into the grain seed', () => {
    for (const k of ['paintGrain', 'paintRelief', 'paintRough', 'paintSpec']) expect(CLASSES.wood.params[k], k).toBeDefined();
    const fs = compile(mats.of('wood') as MeshStandardMaterial).fragmentShader;
    expect(fs).toContain('pHash(floor(woodHue * 911.0) + 0.5)');
    expect(fs).not.toContain('floor(vColor.rgb * 911.0)');
    expect(mats.uniforms('wood').c_bareWood).toBeDefined();
  });

  it('turns the satin lobe down and leaves gloss to the coat; chips cluster', () => {
    const fs = compile(mats.of('steel') as MeshStandardMaterial).fragmentShader;
    expect(fs).toContain('pSpec = mix(mix(u_satinSpec, u_glossSpec, fin), 1.0, chip);');
    expect(fs).toContain('material.specularColor *= pSpec;');
    expect(fs).toContain('u_clusterClean');
  });

  it('advances the belt with simulation time and flickers bulbs deterministically', () => {
    const m = createMaterials({ tier: 'high' });
    const belt = m.uniforms('belt');
    m.update(0);
    expect(belt.u_offset!.value).toBe(0);
    m.update(2);
    expect(belt.u_offset!.value).toBeCloseTo(2 * (belt.u_speed!.value as number));
    const f1 = m.uniforms('bulb').u_flicker!.value;
    m.update(2);
    expect(m.uniforms('bulb').u_flicker!.value).toBe(f1);
    expect(Math.abs((f1 as number) - 1)).toBeLessThan(0.2);
    m.dispose();
  });

  it('bakes the same noise every time, four independent fields around 0.5', () => {
    const a = bakeNoise(7);
    expect(a.length).toBe(NOISE_SIZE ** 3 * 4);
    expect(bakeNoise(7)).toEqual(a);
    const mean = [0, 0, 0, 0];
    for (let i = 0; i < a.length; i++) mean[i % 4]! += a[i]! / 255 / NOISE_SIZE ** 3;
    for (const m of mean) expect(m).toBeGreaterThan(0.45), expect(m).toBeLessThan(0.55);
    let corr = 0;
    for (let i = 0; i < a.length; i += 4) corr += (a[i]! / 255 - mean[0]!) * (a[i + 1]! / 255 - mean[1]!);
    expect(Math.abs(corr / NOISE_SIZE ** 3)).toBeLessThan(0.002);
  });

  it('keeps every colour in the palette (check-look over the folder)', () => {
    const dir = 'src/workshop/view/materials';
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const path = join(dir, f);
      expect(lookViolations(path, readFileSync(path, 'utf8'))).toEqual([]);
    }
  });
});
