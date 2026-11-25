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
import { AdditiveBlending, MeshBasicMaterial, type Mesh, MeshPhysicalMaterial, MeshStandardMaterial, ShaderChunk, type Color, type Data3DTexture, type Material, type Object3D, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import type { MaterialClass } from '../kit/types.ts';
import type { Labels, Materials, Tier } from '../types.ts';
import { CLASSES, CLASS_NAMES, tok, type ClassDef, type Param } from './classes.ts';
import { createNoiseTexture, NOISE_PERIOD } from './noise.ts';
import { LAMP_GLOW } from './lamp-glow.ts';
import { BUTTON_GLOW } from './button-glow.ts';
import { SchemeState, schemeUniforms, type SchemeUniforms } from './scheme.ts';
import {
  DEBUG_PARS,
  FRAGMENT_CLOSE,
  FRAGMENT_EMISSIVE,
  FRAGMENT_GLINT,
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
export { HOME_SCHEME, SCHEME_IDS, SCHEME_LOOK, SCHEME_SLOTS, SCHEMES, SchemeState, slotMultiplier, slotOf, type SchemeId, type SchemeSlot } from './scheme.ts';

/**
 * Review views. 'clay': one neutral matte tone (form, bevels and shadow only).
 * 'wear' | 'cavity' | 'finish': that surf channel as a ramp over the clay.
 * 'lpos': material-space bands every half unit (x yellow, y/z teal).
 * Every procedural layer, map roughness and emission is switched off.
 */
export type DebugView = 'clay' | 'wear' | 'cavity' | 'finish' | 'lpos';
export const DEBUG_VIEWS: readonly DebugView[] = ['clay', 'wear', 'cavity', 'finish', 'lpos'];

export interface MaterialsOptions {
  tier: Tier;
  /** Build every material as a review view instead of its real look. */
  debug?: DebugView;
  /** Source of label textures for `textured()`. May also be given later with `setLabels`. */
  labels?: Labels;
}

/** Live uniforms of one class: `u_<param>` numbers and `c_<colour>` colours, shared by its textured variants. */
export type ClassUniforms = Record<string, { value: number | Color }>;

/**
 * 'large': the cheap path for big flat surfaces that fill the screen (the
 * bench top): fewer layers, no scratch pass. Only `wood` has one today; other
 * classes return their normal material.
 * 'lamp': the lamp's own lit parts, tinted with the lamp's colour (lamp-glow.ts). Only `bulb`.
 * 'button' (L2): the Button's lit cap, its glow breathing (button-glow.ts). Only `bulb`.
 */
export type MaterialVariant = 'large' | 'lamp' | 'button';

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
  /** The review view this instance was built for, if any. */
  readonly debug: DebugView | undefined;
  /**
   * The blob contact-shadow decal (view/effects/blob-shadows): a soft radial
   * falloff from the quad's uv, tinted toward `teal-deep`, depth-tested
   * without depth write, polygon offset. Per-instance strength rides in the
   * instance colour's red channel. Shared; one per materials instance.
   */
  decal(): MeshBasicMaterial;
  /**
   * The keyboard focus mark (view/stations/focus.ts): unlit, drawn after and over everything (no depth
   * test), not fogged, not tone-mapped away; white, its vertex colours carrying its two tones (`ink` under
   * `paper`) and each mark's weight. Shared.
   */
  focusMark(): MeshBasicMaterial;
  /**
   * T1: the glow round a lit station lamp (view/effects/lamp-halos.ts): `amber-glow`, added to what is behind
   * it, a soft radial falloff from the quad's uv (a bright core, a long skirt, zero at the rim), depth-tested
   * without depth write so a robot in front hides it, not fogged. Vertex colour carries each halo's level.
   * Never above the bloom threshold on its own: the lamp's bulb blooms; this is its light on what is beside it.
   */
  halo(): MeshBasicMaterial;
  /** (L2) The same glow in `button-red`: the Button's lit cap on its deck and its cover's bars. */
  buttonHalo(): MeshBasicMaterial;
  /** (P4 S5 round three) A see-through twin of a material made here: see `EffectMaterials.seeThrough` (view/types.ts). */
  seeThrough(material: Material, fade: { value: number }): Material | null;
  /**
   * (D2c) The see-through asks for `root`'s meshes to fade (a `{ value }` it drives), or to stop (null). The meshes'
   * materials are set here, with the paint scheme's keep twins (one owner): never by the caller.
   */
  fade(root: Object3D, fade: { value: number } | null): void;
  /** (D2c) The ghosts `fade` will draw `root` with, built and linked ahead: see `EffectMaterials.prepareFade`. */
  prepareFade(root: Object3D, fade: { value: number }, compile: (o: Object3D) => Promise<number>): Promise<number>;
  /**
   * D2, the paint scheme (scheme.ts): which scheme the enamel shows and the wipe to another. `paint.set(id,
   * { time, origin, reduced })`; `update(time)` runs the wipe on. Scheme A is the approved look.
   */
  readonly paint: SchemeState;
  /**
   * Give every workshop material under `root` its twin that never takes the paint scheme (the crew and loose
   * parts: their colours are their own). Same program, same class uniforms. Call once after realising `root`
   * (and again on anything added under it). Returns the meshes changed.
   */
  keepColours(root: Object3D): number;
}

/** The classes whose enamel takes the paint scheme (scheme.ts). */
export const SCHEMED: ReadonlySet<MaterialClass> = new Set(['steel']);

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
  /** The lamp's own lit parts: the bulb class reads LAMP_GLOW (materials/lamp-glow.ts). */
  lampGlow?: boolean;
  /** (L2) The Button's lit cap: the bulb class reads BUTTON_GLOW (materials/button-glow.ts). */
  buttonGlow?: boolean;
  /** Never takes the paint scheme (a `keepColours` twin): same program, `s_on` 0. */
  keep?: boolean;
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

interface Shared {
  tier: Tier;
  noise: { value: Data3DTexture };
  debug: DebugView | undefined;
  debugUniforms: ClassUniforms;
  scheme: SchemeUniforms;
}

function debugUniforms(): ClassUniforms {
  const clay = tok('paper').lerp(tok('steel'), 0.45).multiplyScalar(0.85);
  return {
    d_clay: { value: clay },
    d_hot: { value: tok('button-red') },
    d_cold: { value: tok('paint-blue') },
    d_bandA: { value: tok('tape-yellow') },
    d_bandB: { value: tok('teal-light') },
  };
}

/**
 * (P4 S5 round three; D2c) The screen door: with `u_fade` over 0 a pixel is dropped where a 4×4 ordered pattern lies
 * under it, so the surface behind shows through evenly; at 0 nothing is dropped. ONLY in a see-through twin's program
 * (the `SEE_THROUGH` define, `:ghost` in its key): an opaque shader that may `discard` loses early depth rejection and,
 * on a tile-based GPU (a phone's), hidden-surface removal, so no ordinary program carries it. The ghosts' programs
 * are compiled ahead, off the first frame (`EffectMaterials.prepareFade`), and a body fades only once they are linked.
 * Only the colour pass: the shadow pass draws its own depth material, so the shadow stays whole.
 */
const SCREEN_DOOR = /* glsl */ `
if ( u_fade > 0.0 ) {
  // the 4×4 ordered (Bayer) threshold of this pixel, 0..15
  vec2 sdp = mod( floor( gl_FragCoord.xy ), 4.0 );
  vec2 sda = mod( sdp, 2.0 );
  vec2 sdb = floor( sdp / 2.0 );
  float sdt = 4.0 * mod( 2.0 * sda.x + 3.0 * sda.y, 4.0 ) + mod( 2.0 * sdb.x + 3.0 * sdb.y, 4.0 );
  if ( ( sdt + 0.5 ) / 16.0 < u_fade ) discard;
}`;
/** The fade of every material that is not a see-through twin: none. */
const NO_FADE = { value: 0 };
/** How each material `build` made was built (its see-through twin is built the same: the same program). */
const RECIPES = new WeakMap<Material, { cls: MaterialClass; variant: Variant; sh: Shared }>();

function build(cls: MaterialClass, def: ClassDef, sh: Shared, uniforms: ClassUniforms, variant: Variant, fade: { value: number } = NO_FADE): Pbr {
  const { tier, noise, debug } = sh;
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
    ...(def.params.glintMax ? { CLAMP_GLINT: '' } : {}),
    NOISE_INV_PERIOD: (1 / NOISE_PERIOD).toFixed(8),
  };
  if (tier === 'low') defines.TIER_LOW = '';
  if (variant.map) defines.LABEL_MAP = '';
  // A label's normal map is read in the tangent frame of the label's OWN 0..1 uv (the `uv`
  // attribute), whatever uv the texture is sampled with: on the labels' atlas a region's uv
  // derivatives differ from the label's own texture's, and three's frame takes its lengths
  // from them (T1). On a texture of its own the two are the same uv.
  if (variant.map && variant.normalMap) defines.LABEL_LOCAL_FRAME = '';
  if (variant.alpha === 'spray') defines.LABEL_SPRAY = '';
  if (variant.large) defines.LARGE = '';
  if (variant.lampGlow) defines.LAMP_GLOW = '';
  if (variant.buttonGlow) defines.BUTTON_GLOW = '';
  if (debug) {
    defines.DEBUG_VIEW = '';
    defines[`DEBUG_${debug.toUpperCase()}`] = '';
  }
  mat.defines = { ...(mat.defines ?? {}), ...defines };

  // a see-through twin: its own program (the screen door is in no other)
  const ghost = fade !== NO_FADE;
  if (ghost) mat.defines = { ...mat.defines, SEE_THROUGH: '' };
  const key = [
    'workshop', cls, tier,
    variant.map ? 'map' : '', variant.normalMap ? 'n' : '', variant.roughnessMap ? 'r' : '', variant.alpha ?? '', variant.large ? 'large' : '', variant.lampGlow ? 'lamp' : '', variant.buttonGlow ? 'button' : '',
    debug ?? '', ghost ? 'ghost' : '',
  ].join(':');
  mat.customProgramCacheKey = () => key;
  RECIPES.set(mat, { cls, variant, sh });
  // the paint scheme: shared uniforms, and this material's own switch (a twin's is 0); never in the key
  const scheme: SchemeUniforms | null = SCHEMED.has(cls) ? { ...sh.scheme, s_on: { value: variant.keep ? 0 : 1 } } : null;
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms, { uNoiseTex: noise }, ghost ? { u_fade: fade } : {}, debug ? sh.debugUniforms : {}, variant.lampGlow ? LAMP_GLOW : {}, variant.buttonGlow ? BUTTON_GLOW : {}, scheme ?? {});
    let vs = shader.vertexShader;
    vs = inject(vs, 'common', VERTEX_PARS, 'after');
    vs = inject(vs, 'begin_vertex', VERTEX_MAIN, 'after');
    if (variant.map && variant.normalMap) {
      vs = inject(vs, 'common', 'varying vec2 vLabelUv;', 'after');
      vs = inject(vs, 'begin_vertex', 'vLabelUv = uv;', 'after');
    }
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    if (ghost) fs = inject(fs, 'clipping_planes_fragment', SCREEN_DOOR, 'after');
    fs = inject(fs, 'common', `${ghost ? 'uniform float u_fade;\n' : ''}${FRAGMENT_PARS}\n${DEBUG_PARS}\n${uniformDecls(uniforms)}\n${variant.lampGlow ? uniformDecls(LAMP_GLOW as unknown as ClassUniforms) : ''}\n${variant.buttonGlow ? uniformDecls(BUTTON_GLOW as unknown as ClassUniforms) : ''}\n${scheme ? uniformDecls(scheme as unknown as ClassUniforms) : ''}\n${def.pars ?? ''}`, 'after');
    fs = inject(fs, 'color_fragment', `${FRAGMENT_OPEN}\n{\n${def.glsl}\n}\n${FRAGMENT_CLOSE}`, 'replace');
    fs = inject(fs, 'roughnessmap_fragment', FRAGMENT_ROUGHNESS, 'after');
    fs = inject(fs, 'metalnessmap_fragment', FRAGMENT_METALNESS, 'after');
    if (variant.map && variant.normalMap) {
      fs = inject(fs, 'common', 'varying vec2 vLabelUv;', 'after');
      if (!ShaderChunk.normal_fragment_begin.includes('vNormalMapUv')) throw new Error('materials: normal_fragment_begin has no vNormalMapUv (three changed?)');
      fs = inject(fs, 'normal_fragment_begin', ShaderChunk.normal_fragment_begin.replace('vNormalMapUv', 'vLabelUv'), 'replace');
    }
    fs = inject(fs, 'normal_fragment_maps', FRAGMENT_NORMAL, 'after');
    fs = inject(fs, 'emissivemap_fragment', FRAGMENT_EMISSIVE, 'after');
    fs = inject(fs, 'lights_physical_fragment', FRAGMENT_SHEEN, 'after');
    fs = inject(fs, 'opaque_fragment', FRAGMENT_GLINT, 'before');
    if ((def.props['clearcoat'] ?? 0) > 0) fs = coatOnlyWhereCoated(fs);
    shader.fragmentShader = fs;
  };
  return mat;
}

/**
 * F1: the clearcoat lobe is worked out only where there is a coat. A class with a clearcoat (steel, tape) has one
 * per pixel (`pCoat`), and on most enamel it is 0 (finish 0); three works the lobe out for every light and the
 * environment anyway and then multiplies it by that 0. Skipped where the coat is 0, the sum it was added to is the
 * same number (x + 0 × lobe is x), so the picture is the same pixel for pixel; the measured gain is the lobe's
 * share of the scene pass (about 0.3 ms at home on the reference laptop).
 */
const COAT_GUARDS: ReadonlyArray<[chunk: string, find: string]> = [
  ['lights_physical_pars_fragment', 'clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat('],
  ['lights_physical_pars_fragment', 'clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF('],
  ['lights_fragment_maps', 'clearcoatRadiance += getIBLRadiance('],
];

export function coatOnlyWhereCoated(fs: string): string {
  const chunks = new Map<string, string>();
  for (const [chunk, find] of COAT_GUARDS) {
    const src = chunks.get(chunk) ?? (ShaderChunk as unknown as Record<string, string>)[chunk]!;
    if (!src.includes(find)) throw new Error(`materials: <${chunk}> has no "${find}" (three changed?)`);
    chunks.set(chunk, src.replace(find, `if ( material.clearcoat > 0.0 ) ${find}`));
  }
  for (const [chunk, src] of chunks) fs = inject(fs, chunk, src, 'replace');
  return fs;
}

/** A twin is named after the material it stands in for. */
function named(t: Pbr, of: Material): Pbr {
  t.name = `${of.name}/own-colours`;
  return t;
}

/** The focus mark: see WorkshopMaterials.focusMark. */
function buildFocusMark(): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.name = 'workshop/focus-mark';
  // (K2) white: the vertex colours carry the mark's two tones, `ink` under `paper` (view/stations/focus.ts)
  m.color.setScalar(1);
  m.vertexColors = true;
  m.transparent = true;
  m.depthTest = false;
  m.depthWrite = false;
  m.fog = false;
  m.toneMapped = false;
  return m;
}

/** A lit station lamp's glow: see WorkshopMaterials.halo. */
function buildHalo(token: 'amber-glow' | 'button-red' = 'amber-glow'): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.name = token === 'amber-glow' ? 'workshop/halo' : `workshop/halo/${token}`;
  m.color.copy(tok(token));
  m.vertexColors = true;
  m.transparent = true;
  m.blending = AdditiveBlending;
  m.depthTest = true;
  m.depthWrite = false;
  m.fog = false;
  m.toneMapped = true;
  m.defines = { USE_UV: '' };
  m.customProgramCacheKey = () => 'workshop:halo'; // (the colour is a uniform: one program for both)
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = inject(
      shader.fragmentShader,
      'color_fragment',
      /* glsl */ `
{
  // a warm core and a long soft skirt, exactly zero at the rim; the level rides in the vertex colour's red
  float r = clamp(length(vUv * 2.0 - 1.0), 0.0, 1.0);
  float f = exp(-9.0 * r * r) * 0.75 + exp(-2.6 * r * r) * 0.25;
  diffuseColor.rgb *= f * (1.0 - r * r) * vColor.r;
  diffuseColor.a = 1.0;
}`,
      'replace',
    );
  };
  return m;
}

/** The blob-shadow decal: see WorkshopMaterials.decal. */
function buildDecal(): MeshBasicMaterial {
  const m = new MeshBasicMaterial();
  m.name = 'workshop/decal';
  // a deep teal, a little darker than the room, never black
  m.color.copy(tok('teal-deep').lerp(tok('ink'), 0.35));
  m.transparent = true;
  m.opacity = 0.85;
  m.depthTest = true;
  m.depthWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  m.fog = false;
  m.toneMapped = true;
  m.defines = { USE_UV: '' };
  m.customProgramCacheKey = () => 'workshop:decal';
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = inject(
      shader.fragmentShader,
      'color_fragment',
      /* glsl */ `
{
  // dense core, long soft skirt, exactly zero at the rim
  float r = clamp(length(vUv * 2.0 - 1.0), 0.0, 1.0);
  diffuseColor.a *= exp(-3.2 * r * r) * (1.0 - r * r * r);
#if defined(USE_INSTANCING_COLOR)
  diffuseColor.a *= vColor.r;
#endif
}`,
      'replace',
    );
  };
  return m;
}

/** Steady with a faint irregular waver: deterministic in `time`, no rng needed. */
function flicker(time: number, amount: number): number {
  const w = Math.sin(time * 13.7) * 0.5 + Math.sin(time * 7.3 + 1.1) * 0.3 + Math.sin(time * 29.1 + 2.3) * 0.2;
  return 1 + w * amount;
}

export function createMaterials(opts: MaterialsOptions): WorkshopMaterials {
  const tier = opts.tier;
  const sh: Shared = { tier, noise: { value: createNoiseTexture() }, debug: opts.debug, debugUniforms: debugUniforms(), scheme: schemeUniforms() };
  const paint = new SchemeState(sh.scheme);
  /**
   * The meshes that keep their own colours, and their twins. A twin is drawn only while the scheme repaints anything:
   * three sorts opaque draws by material before depth, so a mesh on a material of its own is drawn after everything on
   * the shared one, and the expensive steel shader then runs twice where it stands in front (measured: +0.6 ms a frame
   * at home with the twins always in). At home the meshes are on their own materials, as before the scheme existed.
   */
  /**
   * D2c: THE ONE OWNER of a kept or fading mesh's material. Two things change what such a mesh draws with: the paint
   * scheme (a mesh given to `keepColours` goes to its keep twin while a scheme repaints, see above) and the crates'
   * see-through (a crew body in the way of a look fades: `fade`). Neither writes `mesh.material` itself: each sets its
   * own fact here and `apply` works the material out from all of them, so any order of fade, scheme, home and un-fade
   * leaves the right one, and with neither in force the mesh is back on the very material it had.
   *
   *   own    the material the mesh had when it was first owned (what it is given back);
   *   twin   its keep twin (keepColours), or null: drawn while a scheme repaints;
   *   order  its own renderOrder;
   *   fade   the see-through's `{ value }` while it fades, or null: the ghost of whichever of own and twin is drawn
   *          (a ghost of a keep twin keeps `s_on` 0: it is built from the twin's recipe).
   *
   * renderOrder: a kept opaque mesh is drawn first while its twin is in (see above), faded or not. A faded one discards
   * pixels: no depth is written where it does, so what lies behind is still drawn there whatever came first, and
   * where it keeps a pixel it hides what is behind as any opaque draw does. So the order is right either way, and
   * first keeps the machines behind a kept body rejected by depth where the body still stands.
   */
  interface Owned {
    own: Material | Material[];
    twin: Material | null;
    order: number;
    fade: { value: number } | null;
  }
  const owned = new Map<Mesh, Owned>();
  let swapped = false;
  /**
   * While swapped, an opaque kept mesh is drawn first (`renderOrder` sorts before the material): the crew and the
   * loose parts mostly stand in front of the machines, so the machines behind them are then rejected by depth instead
   * of the kept meshes being shaded over them. Transparent ones keep their order (blending depends on it).
   */
  const FIRST = -1;
  const ghostOf = (m: Material, f: { value: number }): Material => api.seeThrough(m, f) ?? m;
  const isOpaque = (m: Material | Material[]): boolean => (Array.isArray(m) ? m.every((x) => !x.transparent) : !m.transparent);
  /** Set the mesh's material and renderOrder from what it is, its twin, the scheme and its fade. */
  const apply = (mesh: Mesh, o: Owned): void => {
    const keep = swapped && o.twin !== null;
    const base: Material | Material[] = keep ? o.twin! : o.own;
    const f = o.fade;
    mesh.material = f ? (Array.isArray(base) ? base.map((x) => ghostOf(x, f)) : ghostOf(base, f)) : base;
    mesh.renderOrder = keep && isOpaque(o.own) ? FIRST : o.order;
    // owned only while something changes it: a mesh with no twin and no fade is its own again, and forgotten
    if (o.twin === null && o.fade === null) owned.delete(mesh);
  };
  paint.onActive = (on) => {
    if (on === swapped) return;
    swapped = on;
    for (const [mesh, o] of owned) if (o.twin) apply(mesh, o);
  };
  /** Every schemed material made, and how to make its twin; the twins made. */
  const twinOf = new Map<Material, () => Pbr>();
  const twins = new Map<Material, Pbr>();
  const noise = sh.noise;
  let decal: MeshBasicMaterial | undefined;
  let focusMark: MeshBasicMaterial | undefined;
  let halo: MeshBasicMaterial | undefined;
  let buttonHalo: MeshBasicMaterial | undefined;
  let labels: Labels | undefined = opts.labels;
  const uniformsBy = new Map<MaterialClass, ClassUniforms>();
  const shared = new Map<string, Pbr>();
  const textured = new Map<string, Pbr>();
  /** (round three) The see-through twins made, per material and fade. */
  const ghosts = new WeakMap<Material, WeakMap<{ value: number }, Pbr>>();
  const ghostList: Pbr[] = [];

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
    const lampGlow = variant === 'lamp' && cls === 'bulb';
    const buttonGlow = variant === 'button' && cls === 'bulb';
    const k = large ? `${cls}:large` : lampGlow ? `${cls}:lamp` : buttonGlow ? `${cls}:button` : cls;
    let m = shared.get(k);
    if (!m) {
      const def = CLASSES[cls];
      if (!def) throw new Error(`materials: unknown class ${String(cls)}`);
      const made = build(cls, def, sh, uniformsOf(cls), { large, lampGlow, buttonGlow });
      if (lampGlow) made.name = `workshop/${cls}/lamp`;
      if (buttonGlow) made.name = `workshop/${cls}/button`;
      if (SCHEMED.has(cls)) twinOf.set(made, () => named(build(cls, def, sh, uniformsOf(cls), { large, lampGlow, keep: true }), made));
      shared.set(k, made);
      m = made;
    }
    return m;
  };
  for (const cls of CLASS_NAMES) of(cls);

  const api: WorkshopMaterials = {
    tier,
    debug: opts.debug,
    decal() {
      decal ??= buildDecal();
      return decal;
    },
    focusMark() {
      focusMark ??= buildFocusMark();
      return focusMark;
    },
    halo() {
      halo ??= buildHalo();
      return halo;
    },
    buttonHalo() {
      buttonHalo ??= buildHalo('button-red');
      return buttonHalo;
    },
    seeThrough(material, fade) {
      // (a shared material, a textured one or a keepColours twin alike: each knows how it was built)
      const r = RECIPES.get(material);
      if (!r || r.sh !== sh) return null;
      let byFade = ghosts.get(material);
      if (!byFade) ghosts.set(material, (byFade = new WeakMap()));
      let t = byFade.get(fade);
      if (!t) {
        t = build(r.cls, CLASSES[r.cls], sh, uniformsOf(r.cls), r.variant, fade);
        t.name = `${material.name}/see-through`;
        byFade.set(fade, t);
        ghostList.push(t);
      }
      return t;
    },
    of,
    textured(cls, key) {
      const k = `${cls}\u0000${key}`;
      let m = textured.get(k);
      if (!m) {
        if (!labels) throw new Error('materials: textured() needs Labels (pass labels to createMaterials or call setLabels)');
        const v: Variant = {
          map: labels.texture(key),
          normalMap: labels.normalMap(key),
          roughnessMap: labels.roughnessMap(key),
          alpha: labelAlpha(labels, key),
        };
        const made = build(cls, CLASSES[cls], sh, uniformsOf(cls), v);
        m = made;
        textured.set(k, made);
        if (SCHEMED.has(cls)) twinOf.set(made, () => named(build(cls, CLASSES[cls], sh, uniformsOf(cls), { ...v, keep: true }), made));
      }
      return m;
    },
    paint,
    keepColours(root) {
      let n = 0;
      root.traverse((x) => {
        const mesh = x as Mesh;
        if (!mesh.isMesh) return;
        const o = owned.get(mesh);
        if (o?.twin) return;
        const own = o ? o.own : mesh.material;
        if (Array.isArray(own)) return;
        const make = twinOf.get(own);
        if (!make) return;
        let t = twins.get(own);
        if (!t) {
          t = make();
          twins.set(own, t);
        }
        const next: Owned = o ?? { own, twin: null, order: mesh.renderOrder, fade: null };
        next.twin = t;
        owned.set(mesh, next);
        apply(mesh, next);
        n++;
      });
      return n;
    },
    prepareFade(root, fade, compile) {
      // each mesh, for the length of the compile call, on the ghost of what it is drawn with at home (the ghost of its
      // keep twin shares that program: it is made now too, so a fade under a scheme builds nothing either)
      const lent: Array<[Mesh, Material | Material[]]> = [];
      root.traverse((x) => {
        const mesh = x as Mesh;
        if (!mesh.isMesh) return;
        const o = owned.get(mesh);
        const own = o ? o.own : mesh.material;
        if (o?.twin) ghostOf(o.twin, fade);
        lent.push([mesh, mesh.material]);
        mesh.material = Array.isArray(own) ? own.map((m) => ghostOf(m, fade)) : ghostOf(own, fade);
      });
      let p: Promise<number>;
      try {
        p = compile(root);
      } finally {
        for (const [mesh, m] of lent) mesh.material = m;
      }
      return p;
    },
    fade(root, fade) {
      root.traverse((x) => {
        const mesh = x as Mesh;
        if (!mesh.isMesh) return;
        const o = owned.get(mesh);
        if (!o && fade === null) return;
        const next: Owned = o ?? { own: mesh.material, twin: null, order: mesh.renderOrder, fade: null };
        next.fade = fade;
        owned.set(mesh, next);
        apply(mesh, next);
      });
    },
    update(time) {
      paint.update(time);
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
      return [...shared.values(), ...textured.values(), ...twins.values()];
    },
    dispose() {
      for (const m of shared.values()) m.dispose();
      for (const m of textured.values()) m.dispose();
      for (const m of ghostList) m.dispose();
      ghostList.length = 0;
      for (const m of twins.values()) m.dispose();
      twins.clear();
      twinOf.clear();
      shared.clear();
      textured.clear();
      noise.value.dispose();
      decal?.dispose();
      decal = undefined;
      focusMark?.dispose();
      focusMark = undefined;
      halo?.dispose();
      halo = undefined;
      buttonHalo?.dispose();
      buttonHalo = undefined;
    },
  };
  return api;
}
