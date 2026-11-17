/**
 * The GLSL shared by every workshop material: object-space varyings, cheap
 * noise (a baked 4-channel volume, one fetch per lookup), straight scratch lines, a footprint fade that keeps high-frequency
 * layers from crawling, and a scale-correct bump perturbation that needs no
 * tangents or UVs.
 *
 * Everything is evaluated in OBJECT space (the geometry's own coordinates),
 * so detail sticks to a part when it moves. Instances add their translation
 * to that space so two copies of one part are not identical.
 */

/** Vertex declarations. */
export const VERTEX_PARS = /* glsl */ `
attribute vec2 surf;
varying vec3 vObj;
varying vec3 vObjN;
varying vec2 vSurf;
#ifdef MAT_BELT
uniform float u_useUv;
uniform float u_uvScale;
varying float vBeltU;
#endif
`;

/** Runs right after <begin_vertex>: `transformed` and `objectNormal` exist. */
export const VERTEX_MAIN = /* glsl */ `
vObj = position;
vObjN = objectNormal;
vSurf = surf;
#ifdef USE_INSTANCING
vObj += instanceMatrix[3].xyz * 3.71;
#endif
#ifdef MAT_BELT
vBeltU = mix(position.x, uv.x * u_uvScale, u_useUv);
#endif
`;

/** Fragment declarations and helpers. */
export const FRAGMENT_PARS = /* glsl */ `
varying vec3 vObj;
varying vec3 vObjN;
varying vec2 vSurf;
#ifdef MAT_BELT
varying float vBeltU;
#endif

float pHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 pHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
}

// Noise from the shared baked volume (noise.ts): ONE filtered fetch gives
// four independent gradient-noise fields (r, g, b, a), each about 0..1
// around 0.5, at the same frequency. Classes pack their layers into the
// channels so a pixel costs a handful of fetches. The lookup is turned by
// an odd rotation so a flat face never slices the periodic volume along its
// lattice (which would show the tile).
uniform highp sampler3D uNoiseTex;
const mat3 pNoiseRot = mat3(0.7887, 0.5774, -0.2113, -0.2113, 0.5774, 0.7887, 0.5774, -0.5774, 0.5774);
vec4 pNoise4(vec3 x) {
  return texture(uNoiseTex, (pNoiseRot * x) * NOISE_INV_PERIOD);
}
float pNoise(vec3 x) {
  return pNoise4(x).r;
}
// Two octaves of all four fields (two fetches).
vec4 pFbm4(vec3 x) {
  return pNoise4(x) * 0.62 + pNoise4(x * 2.13 + 17.3).gbar * 0.38;
}

// Cheap 1D value noise from the hash (no fetch), 0..1.
float pNoise1(float x, float seed) {
  float i = floor(x);
  float f = fract(x);
  return mix(pHash(vec3(i, seed, 0.5)), pHash(vec3(i + 1.0, seed, 0.5)), f * f * (3.0 - 2.0 * f));
}

// Footprint fade: 1 while a layer of this frequency (cycles per object unit)
// is well above the pixel size, 0 once it would alias.
float pAA(float freq, float fw) {
  return 1.0 - smoothstep(0.18, 0.5, fw * freq);
}

// Derivative of smoothstep(lo, hi, x) with respect to x.
float pSmoothD(float lo, float hi, float x) {
  float t = clamp((x - lo) / (hi - lo), 0.0, 1.0);
  return 6.0 * t * (1.0 - t) / (hi - lo);
}

// One layer of scratches: each cell of a 3D grid may hold one straight
// scratch, the cut of a thin slab (normal across the surface) with the
// surface, tapered at both ends. width is in object units; a line thinner
// than a pixel is faded rather than drawn, so it never sparkles.
float pScratchCell(vec3 p, vec3 n, float cell, float width, float density, float fw, float seed) {
  vec3 g = p / cell + seed;
  vec3 id = floor(g);
  vec3 f = fract(g) - 0.5;
  vec3 rnd = pHash3(id + seed);
  vec3 ex = pHash3(id + seed + 5.3);
  float on = step(1.0 - density, ex.x * 0.5 + 0.5);
  vec3 sn = cross(rnd, n);
  sn *= inversesqrt(max(dot(sn, sn), 1e-6));
  vec3 fc = f - ex.zxy * 0.08;
  float across = abs(dot(fc, sn)) * cell;
  float along = length(fc - sn * dot(fc, sn));
  float len = 0.3 + 0.1 * ex.y;
  float taper = 1.0 - smoothstep(len * 0.35, len, along);
  float w = width * (0.35 + 0.65 * taper);
  float wd = max(w, fw * 0.75);
  // far away a scratch would shrink to a dot: fade it once its cell is a few pixels
  return (1.0 - smoothstep(0.0, wd, across)) * taper * on * (w / wd) * smoothstep(4.0, 10.0, cell / max(fw, 1e-6));
}

// Fine scratches: three layers of straight scratches at different scales.
// 0..1. freq is scratches-cells per object unit.
float pScratches(vec3 p, vec3 n, float freq, float density, float width, float fw) {
  float s = pScratchCell(p, n, 1.0 / freq, width, density, fw, 0.0);
  s = max(s, pScratchCell(p, n, 0.63 / freq, width * 0.8, density, fw, 3.1));
  s = max(s, pScratchCell(p, n, 1.7 / freq, width * 1.2, density * 0.7, fw, 7.4));
  return s;
}

// One layer only: for sparse scuffs on big surfaces (the bench) where cost matters.
float pScratchesLite(vec3 p, vec3 n, float freq, float density, float width, float fw) {
  return pScratchCell(p, n, 1.0 / freq, width, density, fw, 0.0);
}

// Bump mapping from a height's screen derivatives (Mikkelsen 2010), scale
// correct: dB is the height change per pixel in view units.
vec3 pPerturb(vec3 surfPos, vec3 n, vec2 dB, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dB.x * r1 + dB.y * r2);
  return normalize(abs(det) * n - grad);
}
`;

/**
 * Opens the per-class block (replaces <color_fragment>). Sets up the inputs
 * every class reads and the outputs it may write:
 *   in : pBase (albedo: vertex colour, or the label map), pWear, pCav, pP, pN
 *        (object space), pUp (-1..1, facing world up), pFacing (0..1 toward
 *        the camera), pFw (object units per pixel)
 *   out: pAlbedo, pRough, pMetal, pH (height in object units; the normal is
 *        bent by its screen-space slope), pEmit, pSheen
 */
export const FRAGMENT_OPEN = /* glsl */ `
vec3 pBase = diffuseColor.rgb;
#ifndef LABEL_MAP
pBase *= vColor.rgb;
#endif
float pWear = clamp(vSurf.x, 0.0, 1.0);
float pCav = clamp(vSurf.y, 0.0, 1.0);
vec3 pP = vObj;
vec3 pN = normalize(vObjN);
vec3 pVN = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
float pUp = dot(pVN, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
float pFacing = clamp(dot(pVN, normalize(vViewPosition)), 0.0, 1.0);
float pFw = length(fwidth(vObj));
vec3 pAlbedo = pBase;
float pRough = roughness;
float pMetal = metalness;
float pH = 0.0;
vec3 pEmit = vec3(0.0);
vec3 pSheen = vec3(0.0);
`;

export const FRAGMENT_CLOSE = /* glsl */ `
diffuseColor.rgb = max(pAlbedo, vec3(0.0));
`;

export const FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = clamp(pRough, 0.04, 1.0);
`;

export const FRAGMENT_METALNESS = /* glsl */ `
metalnessFactor = clamp(pMetal, 0.0, 1.0);
`;

/** After <normal_fragment_maps>: bend the shading normal by the class's height. */
export const FRAGMENT_NORMAL = /* glsl */ `
{
  vec2 dB = vec2(dFdx(pH), dFdy(pH));
  normal = pPerturb(-vViewPosition, normal, dB, faceDirection);
}
`;

export const FRAGMENT_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += pEmit;
`;

export const FRAGMENT_SHEEN = /* glsl */ `
#ifdef USE_SHEEN
material.sheenColor = pSheen;
#endif
`;
