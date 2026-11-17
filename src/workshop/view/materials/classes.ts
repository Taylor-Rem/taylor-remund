/**
 * The material classes: one definition each. Every art-directable number
 * lives in a class's `params` (each becomes a uniform `u_<name>`, with the
 * range it is sane over); every colour a class needs beyond the vertex
 * colour is derived from palette tokens in `colours` (each becomes a uniform
 * `c_<name>`). Change a look here, nowhere else.
 *
 * GLSL contract for `glsl` (see glsl.ts FRAGMENT_OPEN): read pBase, pWear,
 * pCav, pFinish, pP, pN, pUp, pFacing, pFw; write pAlbedo, pRough, pMetal,
 * pH, pDB, pEmit, pSheen, pCoat/pCoatRough. `LABEL_MAP` is defined on a
 * textured variant (pBase is then the label's albedo), `LARGE` on a class's
 * cheap path for big surfaces. `TIER_LOW` is defined on the low tier: wrap the costly layers
 * (micro-normal, scratches, fibres) in `#ifndef TIER_LOW`.
 *
 * Cost discipline: a noise lookup is a texture fetch that returns FOUR
 * independent fields (pNoise4); each class packs its layers into channels.
 * The fetch count per class is noted beside it. Keep it there.
 */
import { Color } from 'three';
import type { MaterialClass } from '../kit/types.ts';
import { linear, type Token } from '../palette.ts';

export interface Param {
  value: number;
  min: number;
  max: number;
}

export interface ClassDef {
  /** 'physical' when the class needs sheen, clearcoat, ior or specular control. */
  kind: 'standard' | 'physical';
  /** Material properties set once (roughness and metalness are the GLSL's starting values). */
  props: Record<string, number>;
  params: Record<string, Param>;
  colours: () => Record<string, Color>;
  /** Optional GLSL functions for this class (declared after the shared helpers and uniforms). */
  pars?: string;
  glsl: string;
}

const p = (value: number, min: number, max: number): Param => ({ value, min, max });

/** A token as a linear Color. */
export function tok(t: Token): Color {
  return new Color().fromArray(linear(t));
}

/** A token's hue at unit brightness (max channel 1): a multiplicative tint. */
export function tint(t: Token): Color {
  const c = tok(t);
  const m = Math.max(c.r, c.g, c.b, 1e-6);
  return c.multiplyScalar(1 / m);
}

/** Grime: dark, a little brown. */
const grime = (): Color => tok('ink').lerp(tok('wood'), 0.35).multiplyScalar(0.9);
/** Dust: a greyed, lifted beige. */
const dust = (): Color => tok('paper').lerp(tok('steel'), 0.45).multiplyScalar(0.42);
/** Rust: orange paint dragged toward wood and ink, darkened. */
const rust = (): Color => tok('paint-orange').lerp(tok('wood'), 0.55).lerp(tok('ink'), 0.3).multiplyScalar(0.45);

// Shared GLSL fragments used by several classes. The class declares gN
// (grime variation) and dN (dust patchiness), both noise 0..1, first.
const GRIME = /* glsl */ `
{
  float g = clamp(pCav * u_grime * (0.5 + 0.9 * gN), 0.0, 1.0);
  pAlbedo = mix(pAlbedo, c_grime, g * 0.75);
  pRough = mix(pRough, 0.85, g * 0.5);
}
`;

const DUST = /* glsl */ `
{
  float d = smoothstep(0.3, 0.95, pUp) * u_dust * smoothstep(0.15, 0.95, dN) * (1.0 - 0.7 * pWear);
  pAlbedo = mix(pAlbedo, c_dust, d * 0.5);
  pRough = mix(pRough, 0.95, d);
}
`;

export const CLASSES: Record<MaterialClass, ClassDef> = {
  // Painted steel: satin enamel over dark steel, chipped where worn; finish 1
  // is deep wet gloss (the Button's cap) with a clearcoat lobe. 6 fetches
  // (+4 on high tier for a per-pixel chip-edge slope).
  steel: {
    kind: 'physical',
    props: { roughness: 0.45, metalness: 0, envMapIntensity: 0.75, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1 },
    params: {
      roughness: p(0.44, 0.25, 0.7), // satin enamel
      roughVar: p(0.14, 0, 0.3), // slow roughness drift
      toneScale: p(2.6, 0.5, 8), // tonal drift frequency (per unit)
      toneVar: p(0.06, 0, 0.3), // tonal drift strength
      dirt: p(0.09, 0, 0.6), // fine mottled dirt over the whole surface
      dirtScale: p(22, 5, 80),
      // How wear becomes "edge": wear below wearFloor never chips; wear at
      // wearFull counts as a full edge. A low wearFull lets the kit's thin
      // wear gradient next to a bevel (0.03-0.06 units wide, small values)
      // pull chips onto the face; raise it to keep chips on the bevel.
      wearFloor: p(0.03, 0, 0.3),
      wearFull: p(0.55, 0.05, 1),
      chipAmount: p(0.8, 0, 1.5), // how much edge turns into chips
      chipScale: p(11, 4, 40), // chip patch frequency: bigger = smaller patches
      chipNoise: p(1.15, 0.2, 2.5), // raggedness and reach of the patches (how far they bite into a face)
      chipThreshold: p(0.6, 0.3, 0.9), // higher = fewer chips
      maxCover: p(0.45, 0.05, 1), // at most this share of a part may chip, however worn (thin slats, straps, handles)
      cavityGuard: p(0.9, 0, 2), // recesses keep their paint
      fleck: p(0.35, 0, 1), // small flecks knocked off near edges and, rarely, on faces
      fleckScale: p(55, 15, 150),
      chipRim: p(0.06, 0, 0.2), // width of the lighter paint edge round a chip
      rimLighten: p(1.35, 1, 2.2),
      paintThickness: p(0.003, 0, 0.012), // step down into a chip (material units)
      bareMetal: p(0.55, 0, 1),
      bareRough: p(0.4, 0.2, 0.9),
      rust: p(0.4, 0, 1),
      rustEdge: p(0.7, 0, 1), // a trace of rust just inside a chip's edge
      rustEdgeWidth: p(0.04, 0.01, 0.3),
      // Scratches are quiet by default: a scratch on enamel is a slightly
      // lighter, duller line in the paint's own hue, not a bright hair.
      scratch: p(0.55, 0, 1),
      scratchScale: p(14, 2, 40), // scratch cells per unit (a scratch is 0.2-0.8 of a cell)
      scratchDensity: p(0.16, 0, 1), // share of cells holding a scratch
      scratchEdge: p(0.35, 0, 1), // extra, longer scratches, near edges only
      scratchWidth: p(0.0012, 0.0002, 0.01), // material units
      scratchLift: p(1.22, 1, 2), // how much lighter than the paint a scratch is
      grime: p(0.95, 0, 1.5),
      dust: p(0.06, 0, 1),
      peel: p(0.0003, 0, 0.002), // orange-peel amplitude (material units)
      glossRough: p(0.2, 0.02, 0.4), // enamel body roughness under the coat at finish 1
      glossChips: p(0.45, 0, 1), // chip amount kept at finish 1 (a gloss coat is tougher)
      glossDeepen: p(0.76, 0.5, 1), // thick wet enamel reads deeper in colour
      coat: p(1.0, 0, 1), // clearcoat lobe strength at finish 1
      coatRough: p(0.02, 0.0, 0.3), // small, crisp highlight
    },
    colours: () => ({
      bare: tok('steel').lerp(tok('ink'), 0.4).multiplyScalar(0.5),
      rust: rust(),
      rustEdge: tok('paint-orange').lerp(tok('wood'), 0.5).multiplyScalar(0.4),
      primer: tok('paper').lerp(tok('steel'), 0.6).multiplyScalar(0.55),
      grime: grime(),
      dust: dust(),
    }),
    pars: /* glsl */ `
float steelEdge(float wear) {
  return smoothstep(u_wearFloor, u_wearFull, wear);
}
float steelChipField(vec3 q, float base) {
  vec3 x = q * u_chipScale;
  float n = pNoise4(x).r * 0.62 + pNoise4(x * 2.13 + 17.3).g * 0.38;
  return base + (n - 0.5) * u_chipNoise;
}
`,
    glsl: /* glsl */ `
float fin = pFinish;
vec4 T = pNoise4(pP * u_toneScale);            // r tone, g tone2, b fleck gate, a dust
vec4 D = pFbm4(pP * u_dirtScale + 13.0);       // r dirt, g grime var, b rust var
vec4 C = pFbm4(pP * u_chipScale);              // r chip outline, g roughness drift, b cover gate
vec4 F = pNoise4(pP * u_fleckScale + 11.0);    // r flecks, g bare variation, b rust patches, a orange peel
float gN = D.g;
float dN = T.a;
vec3 paint = pBase * (1.0 + (T.r - 0.5) * u_toneVar * 2.0 * (1.0 - fin) + (T.g - 0.5) * u_toneVar);
float dirtM = smoothstep(0.3, 0.95, D.r) * u_dirt * (1.0 - 0.7 * fin);
paint *= 1.0 - dirtM;
paint *= mix(1.0, u_glossDeepen, fin);

// Chips: patches whose size and shape come from the noise, placed by how
// much of an edge this is, kept out of recesses, and capped so a part that is
// worn everywhere (a slat, a strap) cannot lose all its paint.
float chipAmt = u_chipAmount * mix(1.0, u_glossChips, fin);
float E = steelEdge(pWear);
float guard = smoothstep(0.15, 0.6, pCav) * u_cavityGuard;
float cover = smoothstep(1.0 - u_maxCover - 0.12, 1.0 - u_maxCover + 0.12, C.b);
float fleckGate = E * 0.75 + 0.25 * smoothstep(0.6, 0.9, T.b);
float fleckF = smoothstep(0.72, 0.9, F.r) * fleckGate * u_fleck * (1.0 - 0.6 * fin);
float base = E * chipAmt - guard - (1.0 - cover) * 0.7 + fleckF * 0.45;
float field = base + (C.r - 0.5) * u_chipNoise;
float aw = max(fwidth(field) * 0.7, 1e-4);
float chip = smoothstep(u_chipThreshold - aw, u_chipThreshold + aw, field);
float rimLo = u_chipThreshold - u_chipRim;
float rim = smoothstep(rimLo, u_chipThreshold, field) * (1.0 - chip);
float stepLo = u_chipThreshold - u_chipRim * 2.0;
#ifndef TIER_LOW
// the paint step as a true per-pixel slope (no 2x2 stair on the rim)
{
  float h0 = -u_paintThickness * smoothstep(stepLo, u_chipThreshold, field);
  float other = base - E * chipAmt;
  float fx = steelChipField(pP + dFdx(pP), steelEdge(pWear + dFdx(pWear)) * chipAmt + other);
  float fy = steelChipField(pP + dFdy(pP), steelEdge(pWear + dFdy(pWear)) * chipAmt + other);
  pDB = vec2(-u_paintThickness * smoothstep(stepLo, u_chipThreshold, fx) - h0, -u_paintThickness * smoothstep(stepLo, u_chipThreshold, fy) - h0);
}
#else
pH = -u_paintThickness * smoothstep(stepLo, u_chipThreshold + aw, field);
#endif

// bare steel: mid-dark, a little metallic so it catches the lamp; rust in
// patches and a thin trace just inside the chip edge
vec3 bare = c_bare * (0.7 + 0.6 * F.g);
float rustM = smoothstep(0.55, 0.9, F.b * 0.8 + pCav * 0.3 + (1.0 - pWear) * 0.2) * u_rust;
bare = mix(bare, c_rust * (0.6 + 0.8 * D.b), rustM);
float edgeIn = chip * (1.0 - smoothstep(u_chipThreshold, u_chipThreshold + u_rustEdgeWidth, field));
bare = mix(bare, c_rustEdge * (0.7 + 0.6 * F.g), edgeIn * u_rustEdge);
vec3 edgeCol = mix(paint * u_rimLighten, c_primer, 0.25);
paint = mix(paint, edgeCol, rim * 0.7);

float scr = 0.0;
#ifndef TIER_LOW
{
  float s1 = pScratchCell(pP, pN, 1.0 / u_scratchScale, u_scratchWidth, u_scratchDensity, pFw, 0.0);
  float s2 = pScratchCell(pP, pN, 2.6 / u_scratchScale, u_scratchWidth * 1.2, u_scratchEdge * E, pFw, 7.4);
  scr = max(s1, s2) * u_scratch * (1.0 - 0.5 * fin) * (1.0 - smoothstep(0.2, 0.6, pCav));
}
#endif
// a scratch is the paint, a little lighter and duller; a chip shows the substrate
vec3 scrCol = paint * u_scratchLift + c_primer * 0.04;
vec3 col = mix(paint, scrCol, scr * (1.0 - chip));
pAlbedo = mix(col, bare, chip);
pMetal = u_bareMetal * chip * (1.0 - max(rustM, edgeIn * u_rustEdge));
float paintRough = u_roughness + (C.g - 0.5) * u_roughVar * 1.5 + dirtM * 0.4;
paintRough = mix(paintRough, u_glossRough, fin);
pRough = mix(paintRough, u_bareRough + rustM * 0.3 + edgeIn * 0.2, chip);
pRough = mix(pRough, pRough + 0.18, scr * (1.0 - chip));
${GRIME}
${DUST}
#ifndef TIER_LOW
pH += (F.a - 0.5) * u_peel * (1.0 - chip) * (1.0 - fin) * pAA(u_fleckScale, pFw);
#endif
#ifdef USE_CLEARCOAT
pCoat = u_coat * fin * (1.0 - chip) * (1.0 - scr * 0.5);
pCoatRough = u_coatRough;
#endif
`,
  },

  // Brass: warm full metal, brushed along the part, turned rings on its end
  // faces, polished where worn, patina in the creases; finish 1 is
  // hand-polished. 4 fetches.
  brass: {
    kind: 'standard',
    props: { roughness: 0.35, metalness: 1, envMapIntensity: 1.0 },
    params: {
      bright: p(1.5, 0.8, 2.5), // albedo lift over the token (metal reflectance)
      desat: p(0.12, 0, 0.7), // a little paler than the paint token
      yellow: p(0.1, 0, 0.3), // pulls the hue from copper toward the brass token's yellow
      metal: p(0.82, 0.5, 1), // below 1 keeps a little diffuse: flat plates stay warm gold with nothing bright to mirror
      roughMin: p(0.32, 0.05, 0.6), // roughness floor: a soft sheen, not a mirror of the dark room
      roughMax: p(0.5, 0.2, 0.8),
      brushScale: p(220, 60, 600), // streak frequency across the brushing (along lpos +X)
      brushContrast: p(0.17, 0, 0.6),
      turnScale: p(160, 40, 500), // turned rings per unit of radius on end faces
      turnContrast: p(0.55, 0, 1),
      hairScale: p(14, 3, 60), // hairline polishing scratches
      hairDensity: p(0.5, 0, 1),
      tarnishScale: p(3.5, 1, 12),
      tarnish: p(0.5, 0, 1),
      tarnishDark: p(0.62, 0.3, 1),
      polishBright: p(1.45, 1, 2),
      roughPolish: p(0.16, 0.05, 0.4),
      patina: p(0.85, 0, 2),
      dent: p(0.002, 0, 0.006),
      finishRough: p(0.12, 0.03, 0.3), // roughness at finish 1 (hand-polished)
      grime: p(0.5, 0, 1.5),
      dust: p(0.08, 0, 1),
    },
    colours: () => ({
      patina: tok('brass').multiplyScalar(0.28).lerp(tok('teal-light').multiplyScalar(0.3), 0.45),
      grime: grime(),
      dust: dust(),
    }),
    glsl: /* glsl */ `
float fin = pFinish;
float side = pNoise(vec3(pP.x * 2.0, pP.y * u_brushScale, pP.z * u_brushScale));
float rad = length(pP.yz);
float turnN = pNoise(vec3(rad * u_turnScale, pP.x * 3.0, 0.5));
// a crisp ring profile on top of the noise, so turning reads at a glance
float turnRing = 0.5 + 0.5 * sin(rad * u_turnScale * 6.2832 * 0.5 + turnN * 4.0);
float face = mix(turnN, turnRing, 0.5);
float endF = smoothstep(0.55, 0.85, abs(pN.x));
float brush = mix(side, face, endF);
float brushC = mix(u_brushContrast, u_turnContrast, endF) * (1.0 - 0.8 * fin);
brush = mix(0.5, brush, pAA(mix(u_brushScale, u_turnScale, endF), pFw));
vec4 T = pFbm4(pP * u_tarnishScale);            // r tarnish, g patina edge, b dents, a dust
float gN = T.g;
float dN = T.a;
float tarn = T.r;
float polish = max(smoothstep(0.12, 0.75, pWear), fin);
#ifdef LABEL_MAP
vec3 brassC = pBase;
#else
vec3 brassC = pBase * u_bright;
brassC = mix(brassC, vec3(dot(brassC, vec3(0.2126, 0.7152, 0.0722))), u_desat);
brassC.g *= 1.0 + u_yellow;
brassC.b *= 1.0 - u_yellow;
#endif
vec3 col = brassC * (1.0 + (brush - 0.5) * brushC * 2.0);
col *= mix(1.0, u_tarnishDark, smoothstep(0.35, 0.75, tarn) * u_tarnish * (1.0 - fin));
col = mix(col, brassC * u_polishBright * (1.0 + (brush - 0.5) * brushC), polish);
float pat = smoothstep(0.5, 0.85, pCav * u_patina * (1.0 - 0.7 * fin) + (T.g - 0.5) * 0.6);
pAlbedo = mix(col, c_patina * (0.7 + 0.6 * tarn), pat);
pMetal = mix(mix(u_metal, 1.0, fin), 0.15, pat);
pRough = mix(u_roughMin, u_roughMax, brush * 0.65 + tarn * 0.35);
pRough = mix(pRough, u_roughPolish, polish);
pRough = mix(pRough, u_finishRough + (brush - 0.5) * 0.04, fin);
pRough = mix(pRough, 0.8, pat);
#ifndef TIER_LOW
float hair = pScratches(pP, pN, u_hairScale, u_hairDensity, 0.0008, pFw) * (1.0 - pat);
pAlbedo *= 1.0 + hair * 0.35;
pRough = mix(pRough, u_roughPolish * 0.6, hair * 0.7);
pH = T.b * u_dent * (1.0 - 0.5 * fin) + (turnRing - 0.5) * 0.0002 * endF * pAA(u_turnScale, pFw);
#endif
${GRIME}
${DUST}
`,
  },

  // Wood: grain along lpos +X, rings from a pith off the piece, end grain
  // where the part-local normal faces ±X. 4 fetches; the LARGE path (big
  // flat surfaces: the bench top) takes 2 and no scratch pass.
  wood: {
    kind: 'standard',
    props: { roughness: 0.74, metalness: 0, envMapIntensity: 0.4 },
    params: {
      roughness: p(0.76, 0.4, 0.95), // dry, unfinished
      roughVar: p(0.16, 0, 0.4), // patchy: handled areas sheen, dry areas dull
      lateGloss: p(-0.08, -0.3, 0.2), // latewood is denser and a little glossier
      ringFreq: p(17, 6, 80), // growth rings per unit of radius
      ringIrregular: p(0.8, 0, 1.5), // uneven ring spacing
      growth: p(0.9, 0, 2), // slow runs of wide and narrow years
      pithDist: p(0.9, 0.3, 3), // distance of the tree's centre: further = straighter stripes
      taper: p(0.07, 0, 0.3), // rings drift across the face along the grain: cathedral arches
      warp: p(0.05, 0, 0.2), // how much the rings wander
      warpScale: p(3, 1, 20),
      warpLen: p(0.6, 0.05, 3), // along the grain
      wobble: p(0.006, 0, 0.03), // fine ring wobble that breaks straight stripes
      grainContrast: p(0.7, 0, 1),
      early: p(1.12, 0.8, 1.6),
      late: p(0.62, 0.2, 1),
      streakFreq: p(42, 10, 150), // visible grain lines across the board
      streakLen: p(0.9, 0.2, 5),
      streak: p(0.4, 0, 0.8),
      fibreFreq: p(150, 40, 500),
      fibreLen: p(2, 0.5, 20),
      fibreContrast: p(0.45, 0, 0.8),
      pores: p(0.55, 0, 0.9),
      endDark: p(0.68, 0.4, 1),
      edgeWear: p(0.8, 0, 1),
      edgeLight: p(1.3, 1, 2),
      scuffScale: p(9, 2, 40),
      scuffDensity: p(0.6, 0, 1),
      scuffWidth: p(0.002, 0.0002, 0.01),
      grainBump: p(0.00035, 0, 0.003), // latewood stands proud a little (raised grain)
      fibreBump: p(0.0006, 0, 0.002), // micro-relief of open fibres
      poreBump: p(0.0004, 0, 0.002),
      grime: p(0.8, 0, 1.5),
      dust: p(0.15, 0, 1),
    },
    colours: () => ({ grime: grime(), dust: dust() }),
    glsl: /* glsl */ `
float sd = pHash(floor(vColor.rgb * 911.0) + 0.5);
vec3 q = pP + vec3(sd * 17.0, sd * 0.37, sd * 0.53);
vec4 L = pNoise4(q * vec3(u_warpLen, u_warpScale, u_warpScale));            // r warp, g long warp, b tone, a dust
vec4 S = pNoise4(q * vec3(u_streakLen, u_streakFreq, u_streakFreq) + 2.0);   // r streaks, g coarse fibre, b wobble, a roughness
#ifdef LARGE
vec4 E = vec4(S.b, S.a, 0.5, 0.5);
vec4 Fb = vec4(S.g, 0.5, 0.5, 0.5);
#else
vec4 E = pNoise4(pP * 7.0 + 3.0);                                             // r worn-edge var, g grime var
vec4 Fb = pNoise4(q * vec3(u_fibreLen, u_fibreFreq, u_fibreFreq));           // r fibre, g pores
#endif
float gN = E.g;
float dN = L.a;
vec2 pith = vec2(-0.55 - sd * 0.9, -0.85 + sd * 1.1) * u_pithDist;
float warp = (L.r - 0.5) * u_warp + (L.g - 0.5) * u_warp * 2.0 + (S.b - 0.5) * u_wobble;
float r = length(pP.yz - pith) + warp + q.x * u_taper;
float rt = r * u_ringFreq;
float rt2 = rt + (pNoise1(rt * 0.5, sd * 9.0) - 0.5) * u_ringIrregular + (pNoise1(rt * 0.12, sd * 5.0 + 2.0) - 0.5) * u_growth * 3.0;
float ring = fract(rt2);
// earlywood darkens slowly across the ring, then a thin dense latewood line
float late = smoothstep(0.0, 1.0, ring) * 0.35 + smoothstep(0.72, 0.9, ring) * (1.0 - smoothstep(0.94, 1.0, ring)) * 0.65;
late *= 0.55 + 0.45 * pHash(vec3(floor(rt2), sd, 1.0));
late = mix(0.3, late, pAA(u_ringFreq * 1.5, pFw));
float fAA = pAA(u_fibreFreq, pFw);
#ifdef LARGE
fAA = pAA(u_streakFreq, pFw);
#endif
float fibre = mix(0.5, Fb.r, fAA);
float streak = mix(0.5, S.r, pAA(u_streakFreq, pFw));
float pores = 0.0;
#if !defined(TIER_LOW) && !defined(LARGE)
pores = smoothstep(0.78, 0.92, Fb.g) * fAA;
#endif
vec3 col = mix(pBase * u_early, pBase * u_late, late * u_grainContrast);
col *= 1.0 + (fibre - 0.5) * u_fibreContrast + (S.g - 0.5) * u_fibreContrast * 0.9 + (streak - 0.5) * u_streak + (L.b - 0.5) * 0.28;
col *= 1.0 - pores * u_pores * (0.5 + late);
float endg = smoothstep(0.55, 0.85, abs(pN.x));
col *= mix(1.0, u_endDark, endg);
float wornE = smoothstep(0.15, 0.85, pWear) * u_edgeWear * (0.55 + 0.45 * E.r);
col = mix(col, col * u_edgeLight, wornE);
#if !defined(TIER_LOW) && !defined(LARGE)
float sc = pScratchesLite(pP, pN, u_scuffScale, u_scuffDensity, u_scuffWidth, pFw);
col = mix(col, col * 1.45, sc * 0.6);
#endif
pAlbedo = col;
pRough = u_roughness + late * u_lateGloss + endg * 0.1 - wornE * 0.2 + (fibre - 0.5) * 0.12
       + (S.a - 0.5) * u_roughVar + (L.b - 0.5) * u_roughVar * 0.8 + pores * 0.1;
${GRIME}
${DUST}
#ifndef TIER_LOW
pH = late * u_grainBump * (1.0 - endg) + fibre * u_fibreBump * fAA - pores * u_poreBump;
#endif
`,
  },

  // Rubber: near-ink, very matte, grey dust in the grooves, a faint mould stipple. 2 fetches.
  rubber: {
    kind: 'standard',
    props: { roughness: 0.92, metalness: 0, envMapIntensity: 0.3 },
    params: {
      lift: p(1.7, 1, 5), // ink is near black; rubber sits a little above it
      roughness: p(0.88, 0.75, 1),
      mould: p(0.0003, 0, 0.002),
      mouldScale: p(140, 40, 400),
      tone: p(0.14, 0, 0.6),
      dust: p(0.9, 0, 2),
      topDust: p(0.25, 0, 1),
      edgeRub: p(0.6, 0, 1),
    },
    colours: () => ({ dust: dust().multiplyScalar(0.75) }),
    glsl: /* glsl */ `
vec4 M = pNoise4(pP * u_mouldScale);   // r mould stipple, g dust specks
vec4 T = pNoise4(pP * 6.0);            // r tone, g tone2, b dust var, a dust gate
float mAA = pAA(u_mouldScale, pFw);
vec3 col = pBase * u_lift * (1.0 + (T.r - 0.5) * u_tone + (T.g - 0.5) * u_tone * 0.5);
float d = clamp(pCav * u_dust * (0.4 + T.b) + smoothstep(0.4, 1.0, pUp) * u_topDust * mix(0.3, smoothstep(0.55, 0.85, M.g), mAA) * smoothstep(0.3, 0.8, T.a), 0.0, 1.0);
col = mix(col, c_dust, d * 0.8);
float rub = smoothstep(0.3, 0.9, pWear) * u_edgeRub;
col = mix(col, col * 1.7 + c_dust * 0.08, rub);
pAlbedo = col;
pRough = u_roughness + (M.r - 0.5) * 0.06 * mAA - rub * 0.1 + d * 0.06;
#ifndef TIER_LOW
pH = M.r * u_mould * mAA;
#endif
`,
  },

  // Paper: matte, mottled fibre, darker where handled. 3 fetches.
  paper: {
    kind: 'physical',
    props: { roughness: 0.92, metalness: 0, envMapIntensity: 0.35, specularIntensity: 0.18 },
    params: {
      roughness: p(0.9, 0.75, 1),
      mottleScale: p(14, 2, 40),
      mottle: p(0.1, 0, 0.3),
      fibreScale: p(70, 20, 300),
      fibre: p(0.8, 0, 1),
      fibreBump: p(0.00012, 0, 0.001),
      cockle: p(0.0012, 0, 0.005), // slow waviness of the sheet
      handled: p(0.9, 0, 1.5),
      grime: p(0.6, 0, 1.5),
    },
    colours: () => ({
      soil: tint('wood').lerp(tint('steel'), 0.55).multiplyScalar(0.72),
      grime: grime(),
    }),
    glsl: /* glsl */ `
vec4 Mo = pFbm4(pP * u_mottleScale);   // r mottle, g handling var, b grime var, a cockle
float fine = pNoise(pP * 160.0);
float gN = Mo.b;
float fib = 0.0;
#ifndef TIER_LOW
fib = pScratches(pP, pN, u_fibreScale, 0.9, 0.0012, pFw);
#endif
vec3 col = pBase * (1.0 + (Mo.r - 0.5) * u_mottle * 2.0);
col *= 1.0 - fib * u_fibre * 0.16;
col *= 1.0 + (fine - 0.5) * 0.05 * pAA(160.0, pFw);
float handled = clamp(smoothstep(0.2, 1.0, pWear) * u_handled * (0.45 + 0.75 * Mo.g), 0.0, 1.0);
col *= mix(vec3(1.0), c_soil, handled);
pAlbedo = col;
pRough = u_roughness + (Mo.r - 0.5) * 0.06;
${GRIME}
pH = fib * u_fibreBump + Mo.a * u_cockle;
`,
  },

  // Bare steel: machined, mid-rough, rust in the creases. 5 fetches.
  metal: {
    kind: 'standard',
    props: { roughness: 0.4, metalness: 1, envMapIntensity: 0.9 },
    params: {
      bright: p(1.0, 0.5, 1.5),
      roughMin: p(0.28, 0.1, 0.6),
      roughMax: p(0.5, 0.2, 0.8),
      lineScale: p(110, 30, 600), // machining lines per unit
      lineContrast: p(0.25, 0, 0.6),
      rust: p(0.75, 0, 2),
      polish: p(0.15, 0, 0.3),
      grime: p(0.7, 0, 1.5),
      dust: p(0.2, 0, 1),
    },
    colours: () => ({ rust: rust(), grime: grime(), dust: dust() }),
    glsl: /* glsl */ `
float side = pNoise(vec3(pP.x * 3.0, pP.y * u_lineScale, pP.z * 3.0));
float face = pNoise(vec3(length(pP.xz) * u_lineScale, pP.y * 3.0, pP.x * 3.0));
float lines = mix(side, face, smoothstep(0.55, 0.85, abs(pN.y)));
lines = mix(0.5, lines, pAA(u_lineScale, pFw));
vec4 Sm = pFbm4(pP * 3.3);            // r smudge, g rust outline, b rust var, a dust
vec4 R = pNoise4(pP * 30.0);          // r rust grain, g grime var
float gN = R.g;
float dN = Sm.a;
vec3 col = pBase * u_bright * (1.0 + (lines - 0.5) * u_lineContrast * 2.0) * (0.88 + 0.24 * Sm.r);
float rustM = smoothstep(0.4, 0.8, pCav * u_rust + (Sm.g - 0.5) * 0.7) * (0.6 + 0.4 * R.r);
pAlbedo = mix(col, c_rust * (0.6 + 0.8 * Sm.b), rustM);
pMetal = mix(1.0, 0.1, rustM);
pRough = mix(u_roughMin, u_roughMax, lines * 0.4 + Sm.r * 0.6);
pRough = mix(pRough - pWear * u_polish, 0.85, rustM);
pRough = mix(pRough, u_roughMin * 0.4, pFinish * (1.0 - rustM)); // finish 1: polished bright steel
${GRIME}
${DUST}
`,
  },

  // Lens glass: dark, glossy, reflective at grazing angles. 1 fetch.
  glass: {
    kind: 'physical',
    props: { roughness: 0.05, metalness: 0, envMapIntensity: 1.6, ior: 1.52, specularIntensity: 1 },
    params: {
      tint: p(0.22, 0.05, 0.6), // how much of the vertex colour shows through the dark
      roughness: p(0.05, 0.01, 0.3),
      smudge: p(0.12, 0, 0.4),
      smudgeScale: p(6, 1, 20),
    },
    colours: () => ({}),
    glsl: /* glsl */ `
vec4 Sm = pNoise4(pP * u_smudgeScale);
float sm = Sm.r * 0.6 + Sm.g * 0.4;
pAlbedo = pBase * u_tint;
pRough = u_roughness + smoothstep(0.45, 0.8, sm) * u_smudge * (1.0 - pFinish); // finish 1: a clean lens
pMetal = 0.0;
`,
  },

  // Bulb: the only class that glows. Emission is the vertex colour times a
  // level in linear units, chosen per vertex by the finish channel:
  //   finish 0 = a lamp or marquee bulb (lampLevel), finish 1 = an indicator
  //   lamp (indicatorLevel); in between blends. `intensity` dims every bulb
  //   at once (the lamp dip, night). The post chain's bloom threshold is
  //   meant to sit between the brightest lit surface (about 2 linear under
  //   the key) and the indicator level, e.g. 3: lit paint never blooms, both
  //   bulb levels do. A dark vertex colour gives an unlit bulb. No fetch.
  bulb: {
    kind: 'standard',
    props: { roughness: 0.12, metalness: 0, envMapIntensity: 0.5 },
    params: {
      lampLevel: p(9, 0, 30),
      indicatorLevel: p(5, 0, 30),
      intensity: p(1, 0, 2), // global dimmer
      core: p(2.2, 0.2, 4), // how much hotter the middle of the bulb is than its edge
      edge: p(0.3, 0, 1),
      flicker: p(1, 0.8, 1.2), // driven by update(); 1 = steady
      flickerAmount: p(0.025, 0, 0.15),
    },
    colours: () => ({}),
    glsl: /* glsl */ `
float core = pow(pFacing, u_core);
pAlbedo = pBase * 0.3;
float level = mix(u_lampLevel, u_indicatorLevel, pFinish) * u_intensity;
// the edge of a lit bulb is deeper amber, the middle near white-hot
vec3 hot = mix(pBase * pBase * pBase, pBase, core);
pEmit = hot * level * u_flicker * mix(u_edge, 1.0, core);
pRough = 0.12;
`,
  },

  // Felt / flocking (Patch): soft, matte, a fuzzy rim. 3 fetches.
  felt: {
    kind: 'physical',
    props: { roughness: 0.95, metalness: 0, envMapIntensity: 0.4, sheen: 1, sheenRoughness: 0.55, specularIntensity: 0.25 },
    params: {
      roughness: p(0.95, 0.8, 1),
      fibreScale: p(260, 60, 600),
      fibreContrast: p(0.3, 0, 0.6),
      fibreBump: p(0.00022, 0, 0.001),
      clumpScale: p(16, 4, 50),
      clump: p(0.16, 0, 0.4),
      clumpBump: p(0.0008, 0, 0.003),
      fuzz: p(0.8, 0, 1.5), // grazing-angle lift (light-dependent; not emission)
      sheen: p(1.0, 0, 1.5),
      cavDark: p(0.45, 0, 1),
    },
    colours: () => ({ sheen: tok('paper') }),
    glsl: /* glsl */ `
float f1 = pNoise(pP * u_fibreScale);
float fAA = pAA(u_fibreScale, pFw);
float clumps = pFbm4(pP * u_clumpScale).r;
vec3 col = pBase * (1.0 + (f1 - 0.5) * u_fibreContrast * fAA + (clumps - 0.5) * u_clump * 2.0);
col *= 1.0 - pCav * u_cavDark;
float fuzz = pow(1.0 - pFacing, 2.0) * u_fuzz;
pAlbedo = col * (1.0 + fuzz);
pSheen = mix(col, c_sheen, 0.45) * u_sheen;
pRough = u_roughness;
#ifndef TIER_LOW
pH = f1 * u_fibreBump * fAA + clumps * u_clumpBump;
#endif
`,
  },

  // Label and lane tape: glossy plastic, scuffed at the edges. 2 fetches.
  tape: {
    kind: 'physical',
    props: { roughness: 0.32, metalness: 0, envMapIntensity: 0.8, clearcoat: 0.45, clearcoatRoughness: 0.18 },
    params: {
      roughness: p(0.32, 0.1, 0.6),
      edgeScuff: p(0.7, 0, 1),
      grain: p(0.00006, 0, 0.001),
      grainScale: p(160, 40, 400),
      grime: p(0.5, 0, 1.5),
      dust: p(0.03, 0, 1), // dust shows hard on glossy black: keep it a trace
    },
    colours: () => ({ grime: grime(), dust: dust() }),
    glsl: /* glsl */ `
vec4 N = pNoise4(pP * 30.0);   // r tone, g scuff var, b grime var, a dust
float gN = N.b;
float dN = pFbm4(pP * 4.0).r;
float scuff = smoothstep(0.3, 0.9, pWear) * u_edgeScuff * (0.5 + 0.5 * N.g);
pAlbedo = pBase * (0.96 + 0.08 * N.r);
pAlbedo = mix(pAlbedo, pAlbedo * 0.7 + c_dust * 0.25, scuff);
pRough = u_roughness + (N.r - 0.5) * 0.015 + scuff * 0.35;
${GRIME}
${DUST}
#ifndef TIER_LOW
pH = pNoise(pP * u_grainScale) * u_grain * pAA(u_grainScale, pFw);
#endif
`,
  },

  // Conveyor belt: ribbed rubber whose pattern scrolls with u_offset (update()). 1 fetch.
  belt: {
    kind: 'standard',
    props: { roughness: 0.88, metalness: 0, envMapIntensity: 0.3 },
    params: {
      lift: p(1.7, 1, 5),
      roughness: p(0.86, 0.7, 1),
      ribFreq: p(9, 2, 30), // ribs per unit along the belt
      ribHeight: p(0.006, 0, 0.02),
      ribWear: p(0.5, 0, 1),
      grooveDust: p(0.45, 0, 1),
      speed: p(0.6, 0, 3), // units per simulation second
      offset: p(0, -1e6, 1e6), // driven by update()
      useUv: p(1, 0, 1), // 1: uv.x × uvScale runs along the loop (the kit contract); 0: lpos +X
      uvScale: p(1, 0.01, 100),
    },
    colours: () => ({ dust: dust().multiplyScalar(0.75) }),
    glsl: /* glsl */ `
float bu = vBeltU - u_offset;
float rib = fract(bu * u_ribFreq);
float prof = smoothstep(0.0, 0.12, rib) * (1.0 - smoothstep(0.42, 0.55, rib));
float ribAA = pAA(u_ribFreq, pFw);
prof = mix(0.45, prof, ribAA);
vec3 q = vec3(bu, pP.y, pP.z);
vec4 W = pNoise4(q * vec3(3.0, 9.0, 9.0));   // r wear, g tone
vec3 col = pBase * u_lift * (0.9 + 0.2 * W.g);
col = mix(col, c_dust, (1.0 - prof) * u_grooveDust * (0.3 + 0.7 * W.r));
col = mix(col, col * 1.5, prof * u_ribWear * W.r);
pAlbedo = col;
pRough = u_roughness - prof * u_ribWear * 0.1;
pH = prof * u_ribHeight * ribAA;
`,
  },
};

/** The classes, in the order of `MaterialClass`. */
export const CLASS_NAMES = Object.keys(CLASSES) as MaterialClass[];
