/**
 * The post chain (high tier only; W1 brief § 1, REWRITE.md § E3: each pass
 * earns its frame time).
 *
 *   scene ──► MSAA HDR target (colour + resolved depth)
 *            ├─► GTAO at half resolution, from that depth (no second scene draw)
 *            ├─► bloom: threshold above any lit surface, a dual-filter pyramid
 *            ├─► focus blur: a depth-driven gather at half resolution
 *            └─► one composite pass to the screen:
 *                  AO (toward teal, never grey) · sharp/blurred mix by depth ·
 *                  bloom · exposure + filmic tone map · saturation and
 *                  split-tone grade · room fall-off (the background is exactly
 *                  teal-deep) · vignette toward the room colour · dither ·
 *                  sRGB out
 *
 * Every pass is switchable through `flags` (the debug object and the dev
 * page's query string). The full-screen shaders run through three's own
 * `ShaderPass`, so this file constructs no material or mesh itself.
 */
import {
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NearestFilter,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type SpotLight,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { stageColours, type RGB } from './colours.ts';
import type { GpuTimer } from './gpu-timer.ts';

export type ToneMap = 'agx' | 'aces' | 'neutral';

/** Every switchable pass. Flip a field and the next frame follows. */
export interface PassFlags {
  /** Multisampled scene target (anti-aliasing that survives the chain). */
  msaa: boolean;
  /** Crease and contact darkening (GTAO). */
  gtao: boolean;
  /** Bloom on bulbs only. */
  bloom: boolean;
  /** Depth focus blur for the miniature read. */
  focus: boolean;
  /** Saturation and split-tone grade. */
  grade: boolean;
  /** Vignette toward the room colour. */
  vignette: boolean;
  /** Room fall-off below the bench and beyond its ends; the background is exactly teal-deep. */
  fog: boolean;
  /** Coloured shadows: what the key does not reach leans teal, whatever its albedo. */
  shadowTint: boolean;
}

export const PASS_NAMES = ['msaa', 'gtao', 'bloom', 'focus', 'grade', 'vignette', 'fog', 'shadowTint'] as const satisfies readonly (keyof PassFlags)[];

export function defaultFlags(): PassFlags {
  return { msaa: true, gtao: true, bloom: true, focus: true, grade: true, vignette: true, fog: true, shadowTint: true };
}

/** Tuned by eye on the stage dev page; see the W1 report. */
export const LOOK = {
  exposure: 1.0,
  toneMap: 'neutral' as ToneMap,
  /** `scale` is the AO resolution; `power` sharpens the occlusion curve; `strength` mixes it toward the teal occlusion colour. */
  gtao: { scale: 0.5, radius: 0.5, distanceExponent: 1.6, thickness: 1.2, falloff: 1.0, power: 1.8, samples: 6, denoise: 8, denoiseRadius: 6, strength: 1.0 },
  /** Threshold sits above lit paper at the hot spot (about 2-2.5 linear) and below the bulbs (indicator 5, lamp 9 in materials): only bulbs glow; a brass glint at most catches a small halo. */
  bloom: { threshold: 4.5, knee: 0.5, strength: 0.5, radius: 0.85, levels: 5 },
  /** Focus: no blur within `range` (fraction of focus distance); `scale` px of blur per unit of |z−f|/z; capped at `max` px, both at 900 px tall; `far` scales the blur beyond the focus plane. */
  /** Blur grows with |z-f|/z, so it is naturally subtle at wide and station (long distance) and stronger at close. */
  focus: { range: 0.035, scale: 18, max: 9, far: 0.55 },
  grade: { saturation: 0.85, shadow: 0.6, light: 0.18, contrast: 1.04, lift: 0.15 },
  vignette: { amount: 0.3, inner: 0.42, outer: 1.18 },
  /** Below the bench top the world fades to the room over `drop` units; beyond |x| > `halfWidth` over `side`. */
  /** 0.9 (was 2.2): the real bench's apron, lit head-on by the low front fill, read as a bright band; it now falls into the room. */
  fog: { drop: 0.9, halfWidth: 10.4, side: 3.0, strength: 1.0 },
  /**
   * Coloured shadows. In the composite, how much of the key reaches each
   * pixel is rebuilt from the depth buffer (the key's shadow map, its cone
   * and the facing of the surface); where it does not reach, the colour takes
   * the teal's hue at its own luminance. `amount` 0..1 at full shadow;
   * `softness` widens the shadow-map lookup (texels); `bias` is the lookup's
   * depth bias. The colour is `stageColours().shadowTint`.
   */
  shadowTint: { amount: 0.55, softness: 2.5, bias: 0.0015, normalOffset: 0.03 },
};

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const PREFILTER = {
  name: 'StageBloomPrefilter',
  uniforms: { tInput: { value: null as Texture | null }, texel: { value: new Vector2() }, threshold: { value: 1 }, knee: { value: 0.5 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main() {
  vec3 a = texture2D(tInput, vUv + texel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tInput, vUv + texel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture2D(tInput, vUv + texel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture2D(tInput, vUv + texel * vec2( 1.0,  1.0)).rgb;
  float wa = karis(a), wb = karis(b), wc = karis(c), wd = karis(d);
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  rq = rq * rq / (4.0 * knee + 1e-5);
  float w = max(rq, br - threshold) / max(br, 1e-5);
  gl_FragColor = vec4(col * w, 1.0);
}`,
};

const DOWN = {
  name: 'StageBloomDown',
  uniforms: { tInput: { value: null as Texture | null }, texel: { value: new Vector2() } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
uniform sampler2D tInput;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tInput, vUv).rgb * 4.0;
  s += texture2D(tInput, vUv + texel * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tInput, vUv + texel * vec2( 1.0, -1.0)).rgb;
  s += texture2D(tInput, vUv + texel * vec2(-1.0,  1.0)).rgb;
  s += texture2D(tInput, vUv + texel * vec2( 1.0,  1.0)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`,
};

const UP = {
  name: 'StageBloomUp',
  uniforms: { tInput: { value: null as Texture | null }, tBase: { value: null as Texture | null }, texel: { value: new Vector2() }, radius: { value: 0.85 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D tBase;
uniform vec2 texel;
uniform float radius;
varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0);
  s += texture2D(tInput, vUv + texel * vec2(-2.0, 0.0)).rgb;
  s += texture2D(tInput, vUv + texel * vec2( 2.0, 0.0)).rgb;
  s += texture2D(tInput, vUv + texel * vec2(0.0, -2.0)).rgb;
  s += texture2D(tInput, vUv + texel * vec2(0.0,  2.0)).rgb;
  s += texture2D(tInput, vUv + texel * vec2(-1.0, -1.0)).rgb * 2.0;
  s += texture2D(tInput, vUv + texel * vec2( 1.0, -1.0)).rgb * 2.0;
  s += texture2D(tInput, vUv + texel * vec2(-1.0,  1.0)).rgb * 2.0;
  s += texture2D(tInput, vUv + texel * vec2( 1.0,  1.0)).rgb * 2.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + radius * s / 12.0, 1.0);
}`,
};

/** GLSL shared by the focus pass and the composite: depth, blur size, AO. */
const FOCUS_COMMON = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform float cameraNear;
uniform float cameraFar;
uniform float focusDistance;
uniform float focusRange;
uniform float focusScale;
uniform float focusMax;
uniform float focusFar;
uniform float aoStrength;
uniform vec3 occlusion;
uniform vec2 aoTexel;

float depthAt(vec2 uv) { return texture2D(tDepth, uv).x; }

float viewDistance(float d) {
  return -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
}

// Blur radius in full-resolution pixels for a depth sample: zero inside the focus band.
float cocAt(float d) {
  if (d >= 1.0) return focusMax;
  float z = viewDistance(d);
  float off = abs(z - focusDistance) / z;
  // Beyond the focus plane blur grows more slowly, so the sign on the back wall stays legible.
  float k = z > focusDistance ? focusFar : 1.0;
  return min(focusMax, max(0.0, off - focusRange) * focusScale * k);
}

vec3 occludeBy(vec3 c, float ao) {
  return c * mix(vec3(1.0), mix(occlusion, vec3(1.0), ao), aoStrength);
}

vec3 occlude(vec3 c, vec2 uv) {
#ifdef USE_AO
  c = occludeBy(c, texture2D(tAO, uv).r);
#endif
  return c;
}

// Four bilinear taps a texel apart: a cheap last smoothing of the denoised AO.
vec3 occludeSoft(vec3 c, vec2 uv) {
#ifdef USE_AO
  float ao = texture2D(tAO, uv + aoTexel * vec2(-0.75, -0.75)).r
           + texture2D(tAO, uv + aoTexel * vec2( 0.75, -0.75)).r
           + texture2D(tAO, uv + aoTexel * vec2(-0.75,  0.75)).r
           + texture2D(tAO, uv + aoTexel * vec2( 0.75,  0.75)).r;
  c = occludeBy(c, ao * 0.25);
#endif
  return c;
}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const focusUniforms = () => ({
  tColor: { value: null as Texture | null },
  tDepth: { value: null as Texture | null },
  tAO: { value: null as Texture | null },
  cameraNear: { value: 1 },
  cameraFar: { value: 100 },
  focusDistance: { value: 30 },
  focusRange: { value: LOOK.focus.range },
  focusScale: { value: LOOK.focus.scale },
  focusMax: { value: LOOK.focus.max },
  focusFar: { value: LOOK.focus.far },
  aoStrength: { value: LOOK.gtao.strength },
  occlusion: { value: new Vector3() },
  aoTexel: { value: new Vector2(1, 1) },
});

/**
 * The focus blur, at half resolution: a 12-tap Vogel-disk gather whose radius
 * is the centre's blur size. A neighbour counts when its own blur reaches the
 * centre, so a sharp thing in front never smears onto the blurred background.
 */
const FOCUS = {
  name: 'StageFocus',
  defines: {} as Record<string, string | number>,
  uniforms: { ...focusUniforms(), fullTexel: { value: new Vector2() } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
#include <common>
#include <packing>
${FOCUS_COMMON}
uniform vec2 fullTexel;
varying vec2 vUv;
void main() {
  float d = depthAt(vUv);
  float coc = cocAt(d);
  vec3 sum = occlude(texture2D(tColor, vUv).rgb, vUv);
  if (coc < 0.35) { gl_FragColor = vec4(sum, 1.0); return; }
  float wsum = 1.0;
  float phi = ign(gl_FragCoord.xy) * 6.2831853;
  const int N = 12;
  for (int i = 0; i < N; i++) {
    float r = sqrt(float(i) + 0.5) / sqrt(float(N));
    float t = float(i) * 2.399963 + phi;
    vec2 o = r * vec2(cos(t), sin(t)) * coc;
    vec2 uv = vUv + o * fullTexel;
    float ds = depthAt(uv);
    float reach = clamp(cocAt(ds) - length(o) + 1.0, 0.0, 1.0);
    float w = (ds > d + 1e-5) ? 1.0 : reach;
    sum += occlude(texture2D(tColor, uv).rgb, uv) * w;
    wsum += w;
  }
  gl_FragColor = vec4(sum / wsum, 1.0);
}`,
};

const COMPOSITE = {
  name: 'StageComposite',
  defines: {} as Record<string, string | number>,
  uniforms: {
    ...focusUniforms(),
    tFocus: { value: null as Texture | null },
    tBloom: { value: null as Texture | null },
    resolution: { value: new Vector2(1, 1) },
    projInv: { value: new Matrix4() },
    viewInv: { value: new Matrix4() },
    bloomStrength: { value: LOOK.bloom.strength },
    exposure: { value: LOOK.exposure },
    saturation: { value: LOOK.grade.saturation },
    contrast: { value: LOOK.grade.contrast },
    lift: { value: LOOK.grade.lift },
    gradeShadow: { value: new Vector3() },
    gradeLight: { value: new Vector3() },
    gradeAmount: { value: new Vector2(LOOK.grade.shadow, LOOK.grade.light) },
    room: { value: new Vector3() },
    fog: { value: new Vector3(LOOK.fog.drop, LOOK.fog.halfWidth, LOOK.fog.side) },
    fogStrength: { value: LOOK.fog.strength },
    vignette: { value: new Vector3(LOOK.vignette.amount, LOOK.vignette.inner, LOOK.vignette.outer) },
    frame: { value: 0 },
    tKeyShadow: { value: null as Texture | null },
    keyShadowMatrix: { value: new Matrix4() },
    keyShadowTexel: { value: new Vector2(1 / 2048, 1 / 2048) },
    keyPos: { value: new Vector3() },
    keyDir: { value: new Vector3(0, -1, 0) },
    keyCone: { value: new Vector2(0.5, 0.9) },
    shadowTintColour: { value: new Vector3() },
    shadowTintAmount: { value: LOOK.shadowTint.amount },
    shadowTintParams: { value: new Vector3(LOOK.shadowTint.softness, LOOK.shadowTint.bias, LOOK.shadowTint.normalOffset) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
#include <common>
#include <packing>
#include <tonemapping_pars_fragment>
${FOCUS_COMMON}
uniform sampler2D tFocus;
uniform sampler2D tBloom;
uniform vec2 resolution;
uniform mat4 projInv;
uniform mat4 viewInv;
uniform float bloomStrength;
uniform float exposure;
uniform float saturation;
uniform float contrast;
uniform float lift;
uniform vec3 gradeShadow;
uniform vec3 gradeLight;
uniform vec2 gradeAmount;
uniform vec3 room;
uniform vec3 fog;
uniform float fogStrength;
uniform vec3 vignette;
uniform float frame;
#ifdef USE_SHADOW_TINT
#ifdef USE_KEY_SHADOW
uniform sampler2DShadow tKeyShadow;
#endif
uniform mat4 keyShadowMatrix;
uniform vec2 keyShadowTexel;
uniform vec3 keyPos;
uniform vec3 keyDir;
uniform vec2 keyCone;
uniform vec3 shadowTintColour;
uniform float shadowTintAmount;
uniform vec3 shadowTintParams;
#endif
varying vec2 vUv;

vec3 worldAt(vec2 uv, float d) {
  vec4 vp = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vp /= vp.w;
  return (viewInv * vp).xyz;
}

#ifdef USE_SHADOW_TINT
// How much this surface is in the key's shadow, 0..1: inside the key's cone,
// blocked in its shadow map (4 taps, widened where the picture is blurred)
// or facing away from it (normal rebuilt from the depth buffer).
// The surface normal from the depth buffer: of the two neighbours on each
// axis, take the one nearer in depth, so silhouettes and thin parts (a flag,
// a rod) do not borrow the background's slope.
vec3 normalAt(vec2 uv, vec3 wp, float d) {
  vec2 px = 1.0 / resolution;
  float dl = depthAt(uv - vec2(px.x, 0.0));
  float dr = depthAt(uv + vec2(px.x, 0.0));
  float dd = depthAt(uv - vec2(0.0, px.y));
  float du = depthAt(uv + vec2(0.0, px.y));
  vec3 hx = abs(dr - d) < abs(d - dl) ? worldAt(uv + vec2(px.x, 0.0), dr) - wp : wp - worldAt(uv - vec2(px.x, 0.0), dl);
  vec3 hy = abs(du - d) < abs(d - dd) ? worldAt(uv + vec2(0.0, px.y), du) - wp : wp - worldAt(uv - vec2(0.0, px.y), dd);
  return normalize(cross(hx, hy));
}

float keyShadow(vec2 uv, float d, vec3 wp, float blur) {
  vec3 L = normalize(keyPos - wp);
  float cone = smoothstep(keyCone.x, keyCone.y, dot(-L, keyDir));
  // Outside the key's cone there is no key shadow to colour: skip the rest.
  if (cone < 0.002) return 0.0;
  vec3 n = normalAt(uv, wp, d);
  if (dot(n, viewInv[3].xyz - wp) < 0.0) n = -n;
  // Form shadow counts for half: it is already dark in the material's own shading.
  float facing = mix(1.0, smoothstep(0.0, 0.25, dot(n, L)), 0.6);
  float lit = 1.0;
#ifdef USE_KEY_SHADOW
  vec4 sc = keyShadowMatrix * vec4(wp + n * shadowTintParams.z, 1.0);
  sc.xyz /= sc.w;
  if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
    float z = sc.z - shadowTintParams.y;
    vec2 r = keyShadowTexel * (shadowTintParams.x + blur);
    lit = 0.25 * (
      texture(tKeyShadow, vec3(sc.xy + vec2(-r.x, -r.y), z)) +
      texture(tKeyShadow, vec3(sc.xy + vec2( r.x, -r.y), z)) +
      texture(tKeyShadow, vec3(sc.xy + vec2(-r.x,  r.y), z)) +
      texture(tKeyShadow, vec3(sc.xy + vec2( r.x,  r.y), z)));
  }
#endif
  // Shadow only where the key would otherwise have lit: inside its cone.
  // Outside the pool the room and the grade decide; paint there keeps its colour.
  return cone * (1.0 - lit * facing);
}
#endif

void main() {
  float d = depthAt(vUv);
  vec3 col = occludeSoft(texture2D(tColor, vUv).rgb, vUv);

#ifdef USE_FOCUS
  // Sharp where in focus, the half-resolution gather where not.
  float coc = cocAt(d);
  col = mix(col, texture2D(tFocus, vUv).rgb, smoothstep(0.35, 1.5, coc));
#endif

#ifdef USE_SHADOW_TINT
  if (d < 1.0) {
    float blurPx = 0.0;
#ifdef USE_FOCUS
    blurPx = cocAt(d) * 2.0;
#endif
    vec3 wpT = worldAt(vUv, d);
    float shade = keyShadow(vUv, d, wpT, blurPx);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    // Bulbs and lit glass keep their colour.
    float t = shadowTintAmount * shade * (1.0 - smoothstep(1.5, 3.0, lum));
    col = mix(col, lum * shadowTintColour, t);
  }
#endif

#ifdef USE_BLOOM
  col += texture2D(tBloom, vUv).rgb * bloomStrength;
#endif

  col *= exposure;
#if defined( TONEMAP_AGX )
  col = AgXToneMapping(col);
#elif defined( TONEMAP_ACES )
  col = ACESFilmicToneMapping(col);
#else
  col = NeutralToneMapping(col);
#endif
  col = clamp(col, 0.0, 1.0);

#ifdef USE_GRADE
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, saturation), 0.0);
  col = pow(col, vec3(contrast));
  float p = sqrt(l);
  // Split tone: the deep shadows take the teal's hue at their own luminance,
  // the lights lean amber; the toe lifts toward the room colour, never black.
  float sw = (1.0 - smoothstep(0.08, 0.42, p)) * gradeAmount.x;
  float lw = smoothstep(0.55, 0.95, p) * gradeAmount.y;
  col = mix(col, min(vec3(l) * gradeShadow, vec3(1.0)), sw);
  col = mix(col, min(vec3(l) * gradeLight, vec3(1.0)), lw);
  col += room * lift * (1.0 - smoothstep(0.0, 0.25, p));
#endif

#ifdef USE_FOG
  float f = 0.0;
  if (d >= 1.0) {
    f = 1.0;
  } else {
    vec3 wp = worldAt(vUv, d);
    float below = smoothstep(0.0, fog.x, -wp.y - 0.35);
    float beyond = smoothstep(fog.y, fog.y + fog.z, abs(wp.x));
    f = max(below, beyond) * fogStrength;
  }
  col = mix(col, room, f);
#endif

#ifdef USE_VIGNETTE
  vec2 q = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
  float r = length(q) / length(vec2(resolution.x / resolution.y, 1.0) * 0.5);
  float v = smoothstep(vignette.y, vignette.z, r) * vignette.x;
  // Toward a darker room colour, never toward black.
  col = mix(col, room * 0.55, v);
#endif

#if defined( DEBUG_AO )
  col = vec3(texture2D(tAO, vUv).r);
#elif defined( DEBUG_COC )
  col = vec3(cocAt(d) / max(focusMax, 1e-3));
#endif
  vec4 outc = sRGBTransferOETF(vec4(col, 1.0));
  // Dither: half a code value of noise kills banding in the dark teal ramps.
  outc.rgb += (ign(gl_FragCoord.xy + frame * 5.588238) - 0.5) / 255.0;
  gl_FragColor = outc;
}`,
};

interface FsPass {
  pass: ShaderPass;
  u: Record<string, { value: unknown }>;
}

function fsPass(shader: { name: string; uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string; defines?: Record<string, string | number> }): FsPass {
  // '__none' so ShaderPass never overwrites an input: we bind every texture ourselves.
  const pass = new ShaderPass(shader, '__none');
  pass.clear = false;
  return { pass, u: pass.uniforms as Record<string, { value: unknown }> };
}

const setV3 = (u: { value: unknown } | undefined, c: RGB): void => {
  (u!.value as Vector3).set(c[0], c[1], c[2]);
};

const NO_TARGET = null as unknown as WebGLRenderTarget;

export class PostChain {
  readonly flags: PassFlags;
  toneMap: ToneMap = LOOK.toneMap;
  /** Show an intermediate instead of the picture: the AO map, or the blur size (white = most blur). */
  debugView: 'none' | 'ao' | 'coc' = 'none';
  private sceneRT: WebGLRenderTarget;
  private readonly gtao: GTAOPass;
  private readonly prefilter: FsPass;
  private readonly down: FsPass;
  private readonly up: FsPass;
  private readonly focus: FsPass;
  private readonly composite: FsPass;
  private focusRT: WebGLRenderTarget;
  private bloomDown: WebGLRenderTarget[] = [];
  private bloomUp: WebGLRenderTarget[] = [];
  private width = 1;
  private height = 1;
  private samples: number;
  private definesKey = '';
  private frameNo = 0;
  /** Scene-only draw calls and triangles of the last frame (before post), shadow map included. */
  sceneInfo = { calls: 0, triangles: 0 };

  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, flags: PassFlags = defaultFlags()) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.flags = flags;
    this.samples = flags.msaa ? 4 : 0;
    this.sceneRT = this.makeSceneTarget(1, 1);
    this.gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: this.sceneRT.depthTexture ?? undefined });
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.syncGtao();
    this.prefilter = fsPass(PREFILTER);
    this.down = fsPass(DOWN);
    this.up = fsPass(UP);
    this.focus = fsPass(FOCUS);
    this.composite = fsPass(COMPOSITE);
    this.focusRT = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
    const c = stageColours();
    for (const p of [this.focus, this.composite]) setV3(p.u.occlusion, c.occlusion);
    setV3(this.composite.u.gradeShadow, c.gradeShadow);
    setV3(this.composite.u.gradeLight, c.gradeLight);
    setV3(this.composite.u.room, c.room);
    setV3(this.composite.u.shadowTintColour, c.shadowTint);
  }

  private makeSceneTarget(w: number, h: number): WebGLRenderTarget {
    const depth = new DepthTexture(w, h, UnsignedIntType);
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    return new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      samples: this.samples,
      depthTexture: depth,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
  }

  /** Drawing-buffer size in pixels. */
  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.sceneRT.setSize(this.width, this.height);
    const half = (n: number): number => Math.max(1, Math.round(n * 0.5));
    this.gtao.setSize(Math.max(1, Math.round(this.width * LOOK.gtao.scale)), Math.max(1, Math.round(this.height * LOOK.gtao.scale)));
    this.focusRT.setSize(half(this.width), half(this.height));
    for (const t of [...this.bloomDown, ...this.bloomUp]) t.dispose();
    this.bloomDown = [];
    this.bloomUp = [];
    let w = this.width;
    let h = this.height;
    for (let i = 0; i < LOOK.bloom.levels; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      const opts = { type: HalfFloatType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter };
      this.bloomDown.push(new WebGLRenderTarget(w, h, opts));
      this.bloomUp.push(new WebGLRenderTarget(w, h, opts));
    }
    (this.composite.u.resolution!.value as Vector2).set(this.width, this.height);
    (this.focus.u.fullTexel!.value as Vector2).set(1 / this.width, 1 / this.height);
  }

  private syncDefines(): void {
    const f = this.flags;
    const keyShadow = !!this.keyLight?.castShadow && !!this.keyLight.shadow.map?.depthTexture;
    const key = [f.gtao, f.bloom, f.focus, f.grade, f.vignette, f.fog, f.shadowTint, keyShadow, this.toneMap, this.debugView].join();
    if (key === this.definesKey) return;
    this.definesKey = key;
    const d: Record<string, string> = {};
    if (f.gtao) d.USE_AO = '';
    if (f.bloom) d.USE_BLOOM = '';
    if (f.focus) d.USE_FOCUS = '';
    if (f.grade) d.USE_GRADE = '';
    if (f.vignette) d.USE_VIGNETTE = '';
    if (f.fog) d.USE_FOG = '';
    if (f.shadowTint && this.keyLight) d.USE_SHADOW_TINT = '';
    if (f.shadowTint && keyShadow) d.USE_KEY_SHADOW = '';
    if (this.debugView === 'ao') d.DEBUG_AO = '';
    if (this.debugView === 'coc') d.DEBUG_COC = '';
    d[this.toneMap === 'agx' ? 'TONEMAP_AGX' : this.toneMap === 'aces' ? 'TONEMAP_ACES' : 'TONEMAP_NEUTRAL'] = '';
    for (const p of [this.composite, this.focus]) {
      p.pass.material.defines = { ...d };
      p.pass.material.needsUpdate = true;
    }
  }

  private gtaoKey = '';
  /** Push LOOK.gtao into the pass when it changed (it can be tuned live). */
  private syncGtao(): void {
    const g = LOOK.gtao;
    const key = JSON.stringify(g);
    if (key === this.gtaoKey) return;
    const resized = this.gtaoKey !== '' && JSON.parse(this.gtaoKey).scale !== g.scale;
    this.gtaoKey = key;
    this.gtao.updateGtaoMaterial({
      radius: g.radius,
      distanceExponent: g.distanceExponent,
      thickness: g.thickness,
      distanceFallOff: g.falloff,
      scale: g.power,
      samples: g.samples,
    });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.denoiseRadius, rings: 2, samples: g.denoise });
    if (resized) this.setSize(this.width, this.height);
  }

  private syncSamples(): void {
    const want = this.flags.msaa ? 4 : 0;
    if (want === this.samples) return;
    this.samples = want;
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.sceneRT = this.makeSceneTarget(this.width, this.height);
    this.gtao.setGBuffer(this.sceneRT.depthTexture ?? undefined);
  }

  private bindFocusInputs(u: Record<string, { value: unknown }>, focusDistance: number): void {
    u.tColor!.value = this.sceneRT.texture;
    u.tDepth!.value = this.sceneRT.depthTexture;
    u.tAO!.value = this.gtao.gtaoMap;
    u.cameraNear!.value = this.camera.near;
    u.cameraFar!.value = this.camera.far;
    u.focusDistance!.value = focusDistance;
    // Blur sizes are tuned at 900 px tall; the look stays the same at any resolution.
    const k = this.height / 900;
    u.focusRange!.value = LOOK.focus.range;
    u.focusScale!.value = LOOK.focus.scale * k;
    u.focusMax!.value = LOOK.focus.max * k;
    u.focusFar!.value = LOOK.focus.far;
    u.aoStrength!.value = LOOK.gtao.strength;
    (u.aoTexel!.value as Vector2).set(1 / Math.max(1, Math.round(this.width * LOOK.gtao.scale)), 1 / Math.max(1, Math.round(this.height * LOOK.gtao.scale)));
  }

  /** The key light whose reach drives the coloured shadows (the stage sets it). */
  keyLight: SpotLight | null = null;

  private bindKey(u: Record<string, { value: unknown }>): void {
    const k = this.keyLight;
    if (!k) return;
    const map = k.shadow.map?.depthTexture ?? null;
    u.tKeyShadow!.value = map;
    (u.keyShadowMatrix!.value as Matrix4).copy(k.shadow.matrix);
    (u.keyShadowTexel!.value as Vector2).set(1 / k.shadow.mapSize.x, 1 / k.shadow.mapSize.y);
    k.getWorldPosition(u.keyPos!.value as Vector3);
    const tgt = k.target.getWorldPosition(new Vector3());
    (u.keyDir!.value as Vector3).copy(tgt).sub(u.keyPos!.value as Vector3).normalize();
    (u.keyCone!.value as Vector2).set(Math.cos(k.angle), Math.cos(k.angle * (1 - k.penumbra)));
    u.shadowTintAmount!.value = LOOK.shadowTint.amount;
    (u.shadowTintParams!.value as Vector3).set(LOOK.shadowTint.softness, LOOK.shadowTint.bias, LOOK.shadowTint.normalOffset);
  }

  /** Draw one frame: the scene into the HDR target, then the passes, then the screen. */
  render(focusDistance: number, timer: GpuTimer | null): void {
    const r = this.renderer;
    const info = r.info;
    this.syncSamples();
    this.syncDefines();
    this.syncGtao();
    this.frameNo = (this.frameNo + 1) % 1024;

    timer?.begin('scene');
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    timer?.end();
    this.sceneInfo = { calls: info.render.calls, triangles: info.render.triangles };

    if (this.flags.gtao) {
      timer?.begin('gtao');
      // Output Off: it computes the denoised AO map and writes nothing else.
      this.gtao.render(r, this.sceneRT, this.sceneRT, 0, false);
      timer?.end();
    }

    if (this.flags.bloom) {
      timer?.begin('bloom');
      this.renderBloom();
      timer?.end();
    }

    if (this.flags.focus) {
      timer?.begin('focus');
      this.bindFocusInputs(this.focus.u, focusDistance);
      this.focus.pass.render(r, this.focusRT, NO_TARGET, 0, false);
      timer?.end();
    }

    timer?.begin('composite');
    const u = this.composite.u;
    this.bindFocusInputs(u, focusDistance);
    u.tFocus!.value = this.focusRT.texture;
    u.tBloom!.value = this.bloomUp[0]?.texture ?? null;
    (u.projInv!.value as Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.viewInv!.value as Matrix4).copy(this.camera.matrixWorld);
    u.frame!.value = this.frameNo;
    u.exposure!.value = LOOK.exposure;
    u.bloomStrength!.value = LOOK.bloom.strength;
    u.saturation!.value = LOOK.grade.saturation;
    u.contrast!.value = LOOK.grade.contrast;
    u.lift!.value = LOOK.grade.lift;
    (u.gradeAmount!.value as Vector2).set(LOOK.grade.shadow, LOOK.grade.light);
    (u.vignette!.value as Vector3).set(LOOK.vignette.amount, LOOK.vignette.inner, LOOK.vignette.outer);
    (u.fog!.value as Vector3).set(LOOK.fog.drop, LOOK.fog.halfWidth, LOOK.fog.side);
    u.fogStrength!.value = LOOK.fog.strength;
    this.bindKey(u);
    this.composite.pass.renderToScreen = true;
    this.composite.pass.render(r, NO_TARGET, NO_TARGET, 0, false);
    timer?.end();
  }

  private renderBloom(): void {
    const r = this.renderer;
    const levels = this.bloomDown.length;
    const first = this.bloomDown[0];
    if (!first) return;
    const pu = this.prefilter.u;
    pu.tInput!.value = this.sceneRT.texture;
    (pu.texel!.value as Vector2).set(0.5 / this.width, 0.5 / this.height);
    pu.threshold!.value = LOOK.bloom.threshold;
    pu.knee!.value = LOOK.bloom.knee;
    this.prefilter.pass.render(r, first, NO_TARGET, 0, false);
    for (let i = 1; i < levels; i++) {
      const src = this.bloomDown[i - 1]!;
      const dst = this.bloomDown[i]!;
      this.down.u.tInput!.value = src.texture;
      (this.down.u.texel!.value as Vector2).set(0.5 / src.width, 0.5 / src.height);
      this.down.pass.render(r, dst, NO_TARGET, 0, false);
    }
    // Up the pyramid: each level = its own down result + the blurred level below.
    let smaller: WebGLRenderTarget = this.bloomDown[levels - 1]!;
    for (let i = levels - 2; i >= 0; i--) {
      const dst = this.bloomUp[i]!;
      this.up.u.tInput!.value = smaller.texture;
      this.up.u.tBase!.value = this.bloomDown[i]!.texture;
      (this.up.u.texel!.value as Vector2).set(0.5 / smaller.width, 0.5 / smaller.height);
      this.up.u.radius!.value = LOOK.bloom.radius;
      this.up.pass.render(r, dst, NO_TARGET, 0, false);
      smaller = dst;
    }
  }

  dispose(): void {
    this.sceneRT.depthTexture?.dispose();
    this.sceneRT.dispose();
    this.focusRT.dispose();
    this.gtao.dispose();
    for (const p of [this.prefilter, this.down, this.up, this.focus, this.composite]) p.pass.dispose();
    for (const t of [...this.bloomDown, ...this.bloomUp]) t.dispose();
  }
}
