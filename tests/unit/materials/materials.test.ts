// view/materials without a GPU: every class exists and is wired the same way,
// textured variants cache, parameters are live uniforms, update() drives the
// belt and the bulbs, the shader injection finds every chunk it needs in
// three's real sources, and no colour literal lives in the folder.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshPhysicalMaterial, MeshStandardMaterial, ShaderLib, Texture, UniformsUtils, type WebGLProgramParametersWithUniforms } from 'three';
import { describe, expect, it } from 'vitest';
import { lookViolations } from '../../../scripts/check-look.ts';
import { CLASS_NAMES, CLASSES, createMaterials } from '../../../src/workshop/view/materials/index.ts';
import { bakeNoise, NOISE_SIZE } from '../../../src/workshop/view/materials/noise.ts';
import type { MaterialClass } from '../../../src/workshop/view/kit/types.ts';
import type { Labels } from '../../../src/workshop/view/types.ts';

const ALL: MaterialClass[] = ['steel', 'brass', 'wood', 'rubber', 'paper', 'metal', 'glass', 'bulb', 'felt', 'tape', 'belt'];

function fakeLabels(): Labels & { made: string[] } {
  const made: string[] = [];
  const tex = new Map<string, Texture>();
  const key = (t: string): string => {
    if (!tex.has(t)) {
      tex.set(t, new Texture());
      made.push(t);
    }
    return t;
  };
  return {
    made,
    tape: key, stencil: key, card: key, plate: key, sign: key,
    size: () => ({ w: 1, h: 0.2 }),
    texture: (k) => tex.get(k)!,
    normalMap: () => null,
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
      expect(s.vertexShader).toContain('attribute vec2 surf;');
      expect(s.vertexShader).toContain('vObj = position;');
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
    const a = m.textured('tape', labels.tape('DO NOT TOUCH'));
    expect(m.textured('tape', 'DO NOT TOUCH')).toBe(a);
    expect(m.textured('tape', labels.tape('OTHER'))).not.toBe(a);
    expect(m.textured('paper', 'DO NOT TOUCH')).not.toBe(a);
    expect((a as MeshStandardMaterial).map).toBe(labels.texture('DO NOT TOUCH'));
    expect((a as MeshStandardMaterial).defines?.LABEL_MAP).toBe('');
    expect(a.customProgramCacheKey()).not.toBe(m.of('tape').customProgramCacheKey());
    expect(compile(a as MeshStandardMaterial).uniforms.u_edgeScuff).toBe(m.uniforms('tape').u_edgeScuff);
    m.dispose();
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
