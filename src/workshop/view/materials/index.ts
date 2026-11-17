/**
 * The workshop's materials (REWRITE.md § A "five materials", § E3): one
 * shared material per MaterialClass, built on three's PBR materials and
 * extended in `onBeforeCompile` with procedural surface detail evaluated in
 * object space (glsl.ts), driven by the geometry's vertex colour (the palette
 * hue) and its `surf` attribute (x = wear, y = cavity).
 *
 *   const mats = createMaterials({ tier: 'high', labels });
 *   mesh.material = mats.of('steel');
 *   tape.material = mats.textured('tape', labels.tape('DO NOT TOUCH'));
 *   // each frame: mats.update(frame.time);
 *
 * Labels can be passed now or later with `setLabels` (the label textures are
 * made by view/labels, which may be built after the materials).
 */
import { MeshPhysicalMaterial, MeshStandardMaterial, type Color, type Data3DTexture, type Material, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import type { MaterialClass } from '../kit/types.ts';
import type { Labels, Materials, Tier } from '../types.ts';
import { CLASSES, CLASS_NAMES, type ClassDef, type Param } from './classes.ts';
import { createNoiseTexture, NOISE_PERIOD } from './noise.ts';
import {
  FRAGMENT_CLOSE,
  FRAGMENT_EMISSIVE,
  FRAGMENT_METALNESS,
  FRAGMENT_NORMAL,
  FRAGMENT_OPEN,
  FRAGMENT_PARS,
  FRAGMENT_ROUGHNESS,
  FRAGMENT_SHEEN,
  VERTEX_MAIN,
  VERTEX_PARS,
} from './glsl.ts';

export { CLASSES, CLASS_NAMES } from './classes.ts';
export type { ClassDef, Param } from './classes.ts';

export interface MaterialsOptions {
  tier: Tier;
  /** Source of label textures for `textured()`. May also be given later with `setLabels`. */
  labels?: Labels;
}

/** Live uniforms of one class: `u_<param>` numbers and `c_<colour>` colours, shared by its textured variants. */
export type ClassUniforms = Record<string, { value: number | Color }>;

/**
 * 'large': the cheap path for big flat surfaces that fill the screen (the
 * bench top): fewer layers, no scratch pass. Only `wood` has one today; other
 * classes return their normal material.
 */
export type MaterialVariant = 'large';

export interface WorkshopMaterials extends Materials {
  readonly tier: Tier;
  /** The shared material of a class, or its cheap 'large' variant. */
  of(cls: MaterialClass, variant?: MaterialVariant): Material;
  setLabels(labels: Labels): void;
  /** The live uniforms of a class, for art direction (set `.value`; takes effect next frame). */
  uniforms(cls: MaterialClass): ClassUniforms;
  /** Set a class parameter by name, clamped to its range. */
  set(cls: MaterialClass, param: string, value: number): void;
  /** All materials made so far (shared plus textured), e.g. for renderer.compile checks. */
  all(): Material[];
}

type Pbr = MeshStandardMaterial | MeshPhysicalMaterial;

function inject(src: string, chunk: string, code: string, where: 'before' | 'after' | 'replace'): string {
  const tag = `#include <${chunk}>`;
  if (!src.includes(tag)) throw new Error(`materials: shader chunk <${chunk}> not found (three changed?)`);
  const out = where === 'replace' ? code : where === 'before' ? `${code}\n${tag}` : `${tag}\n${code}`;
  return src.replace(tag, out);
}

function uniformDecls(u: ClassUniforms): string {
  return Object.entries(u)
    .map(([name, { value }]) => `uniform ${typeof value === 'number' ? 'float' : 'vec3'} ${name};`)
    .join('\n');
}

function makeUniforms(def: ClassDef): ClassUniforms {
  const u: ClassUniforms = {};
  for (const [name, prm] of Object.entries(def.params)) u[`u_${name}`] = { value: prm.value };
  for (const [name, col] of Object.entries(def.colours())) u[`c_${name}`] = { value: col };
  return u;
}

interface Variant {
  map?: Texture;
  normalMap?: Texture | null;
  roughnessMap?: Texture | null;
  /** How a label's alpha is used: cut the shape (tape ends, slips) or blend it on (sprayed stencil). */
  alpha?: 'cut' | 'spray';
  large?: boolean;
}

/** Classes with a cheaper 'large' path (a LARGE define in their GLSL). */
const HAS_LARGE: ReadonlySet<MaterialClass> = new Set(['wood']);

/**
 * Stencils are blended on (sprayed paint, soft edges, the surface showing
 * through); every other transparent label is cut with alphaTest. The Labels
 * contract does not say which register a key is, so this reads the key's
 * register prefix (view/labels labelKey: `stencil…|text`).
 */
export function labelAlpha(labels: Labels, key: string): 'cut' | 'spray' | undefined {
  if (!labels.transparent(key)) return undefined;
  return key.startsWith('stencil') ? 'spray' : 'cut';
}

function build(cls: MaterialClass, def: ClassDef, tier: Tier, uniforms: ClassUniforms, noise: { value: Data3DTexture }, variant: Variant): Pbr {
  const mat: Pbr = def.kind === 'physical' ? new MeshPhysicalMaterial() : new MeshStandardMaterial();
  mat.name = variant.map ? `workshop/${cls}/textured` : variant.large ? `workshop/${cls}/large` : `workshop/${cls}`;
  mat.vertexColors = true;
  // A geometry without surf or lpos reads them as zeros: finish 0, and lpos
  // falls back to the object position (glsl.ts VERTEX_MAIN).
  (mat as unknown as { defaultAttributeValues: Record<string, number[]> }).defaultAttributeValues = {
    color: [1, 1, 1],
    uv: [0, 0],
    uv1: [0, 0],
    surf: [0, 0, 0],
    lpos: [0, 0, 0],
  };
  for (const [k, v] of Object.entries(def.props)) (mat as unknown as Record<string, number>)[k] = v;
  if (variant.map) mat.map = variant.map;
  if (variant.normalMap) mat.normalMap = variant.normalMap;
  if (variant.roughnessMap) {
    mat.roughnessMap = variant.roughnessMap;
    mat.metalnessMap = variant.roughnessMap;
  }
  if (variant.alpha === 'cut') mat.alphaTest = 0.5;
  if (variant.alpha === 'spray') {
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
  }

  const defines: Record<string, string> = {
    [`MAT_${cls.toUpperCase()}`]: '',
    NOISE_INV_PERIOD: (1 / NOISE_PERIOD).toFixed(8),
  };
  if (tier === 'low') defines.TIER_LOW = '';
  if (variant.map) defines.LABEL_MAP = '';
  if (variant.alpha === 'spray') defines.LABEL_SPRAY = '';
  if (variant.large) defines.LARGE = '';
  mat.defines = { ...(mat.defines ?? {}), ...defines };

  const key = [
    'workshop', cls, tier,
    variant.map ? 'map' : '', variant.normalMap ? 'n' : '', variant.roughnessMap ? 'r' : '', variant.alpha ?? '', variant.large ? 'large' : '',
  ].join(':');
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms, { uNoiseTex: noise });
    let vs = shader.vertexShader;
    vs = inject(vs, 'common', VERTEX_PARS, 'after');
    vs = inject(vs, 'begin_vertex', VERTEX_MAIN, 'after');
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = inject(fs, 'common', `${FRAGMENT_PARS}\n${uniformDecls(uniforms)}\n${def.pars ?? ''}`, 'after');
    fs = inject(fs, 'color_fragment', `${FRAGMENT_OPEN}\n{\n${def.glsl}\n}\n${FRAGMENT_CLOSE}`, 'replace');
    fs = inject(fs, 'roughnessmap_fragment', FRAGMENT_ROUGHNESS, 'after');
    fs = inject(fs, 'metalnessmap_fragment', FRAGMENT_METALNESS, 'after');
    fs = inject(fs, 'normal_fragment_maps', FRAGMENT_NORMAL, 'after');
    fs = inject(fs, 'emissivemap_fragment', FRAGMENT_EMISSIVE, 'after');
    fs = inject(fs, 'lights_physical_fragment', FRAGMENT_SHEEN, 'after');
    shader.fragmentShader = fs;
  };
  return mat;
}

/** Steady with a faint irregular waver: deterministic in `time`, no rng needed. */
function flicker(time: number, amount: number): number {
  const w = Math.sin(time * 13.7) * 0.5 + Math.sin(time * 7.3 + 1.1) * 0.3 + Math.sin(time * 29.1 + 2.3) * 0.2;
  return 1 + w * amount;
}

export function createMaterials(opts: MaterialsOptions): WorkshopMaterials {
  const tier = opts.tier;
  let labels: Labels | undefined = opts.labels;
  const uniformsBy = new Map<MaterialClass, ClassUniforms>();
  const shared = new Map<string, Pbr>();
  const textured = new Map<string, Pbr>();
  const noise = { value: createNoiseTexture() };

  const uniformsOf = (cls: MaterialClass): ClassUniforms => {
    let u = uniformsBy.get(cls);
    if (!u) {
      u = makeUniforms(CLASSES[cls]);
      uniformsBy.set(cls, u);
    }
    return u;
  };

  const of = (cls: MaterialClass, variant?: MaterialVariant): Pbr => {
    const large = variant === 'large' && HAS_LARGE.has(cls);
    const k = large ? `${cls}:large` : cls;
    let m = shared.get(k);
    if (!m) {
      const def = CLASSES[cls];
      if (!def) throw new Error(`materials: unknown class ${String(cls)}`);
      m = build(cls, def, tier, uniformsOf(cls), noise, { large });
      shared.set(k, m);
    }
    return m;
  };
  for (const cls of CLASS_NAMES) of(cls);

  const api: WorkshopMaterials = {
    tier,
    of,
    textured(cls, key) {
      const k = `${cls}\u0000${key}`;
      let m = textured.get(k);
      if (!m) {
        if (!labels) throw new Error('materials: textured() needs Labels (pass labels to createMaterials or call setLabels)');
        m = build(cls, CLASSES[cls], tier, uniformsOf(cls), noise, {
          map: labels.texture(key),
          normalMap: labels.normalMap(key),
          roughnessMap: labels.roughnessMap(key),
          alpha: labelAlpha(labels, key),
        });
        textured.set(k, m);
      }
      return m;
    },
    update(time) {
      const belt = uniformsOf('belt');
      const speed = belt.u_speed?.value;
      if (belt.u_offset && typeof speed === 'number') belt.u_offset.value = time * speed;
      const bulb = uniformsOf('bulb');
      const amt = bulb.u_flickerAmount?.value;
      if (bulb.u_flicker && typeof amt === 'number') bulb.u_flicker.value = flicker(time, amt);
    },
    setLabels(l) {
      labels = l;
    },
    uniforms: uniformsOf,
    set(cls, param, value) {
      const prm: Param | undefined = CLASSES[cls].params[param];
      const u = uniformsOf(cls)[`u_${param}`];
      if (!prm || !u) throw new Error(`materials: ${cls} has no parameter ${param}`);
      u.value = Math.min(prm.max, Math.max(prm.min, value));
    },
    all() {
      return [...shared.values(), ...textured.values()];
    },
    dispose() {
      for (const m of shared.values()) m.dispose();
      for (const m of textured.values()) m.dispose();
      shared.clear();
      textured.clear();
      noise.value.dispose();
    },
  };
  return api;
}
