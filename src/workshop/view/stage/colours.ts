/**
 * Every colour the stage uses, derived in code from palette tokens
 * (art-direction § 4). No literal colours here: only mixes, scales and
 * normalisations of `linear(token)`. Pure maths, so it is tested in Node.
 *
 * All triples are LINEAR rgb (the renderer's working space).
 */
import { linear, type Token } from '../palette.ts';

export type RGB = readonly [number, number, number];

const WHITE: RGB = [1, 1, 1];

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** Rec. 709 relative luminance of a linear triple. */
export function luminance(a: RGB): number {
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/** The same hue at luminance 1, so a light's colour and its intensity stay separate knobs. */
export function unitLuminance(a: RGB): RGB {
  const l = luminance(a);
  return l > 0 ? scale(a, 1 / l) : WHITE;
}

/** Desaturate toward its own luminance by t (0 = as is, 1 = grey). */
export function desaturate(a: RGB, t: number): RGB {
  const l = luminance(a);
  return mix(a, [l, l, l], t);
}

const tok = (t: Token): RGB => linear(t);

/** Push a colour's chroma away from its own luminance by k (1: as it is), never below `floor` per channel. */
export function saturate(a: RGB, k: number, floor = 0.02): RGB {
  const l = luminance(a);
  return [Math.max(floor, l + (a[0] - l) * k), Math.max(floor, l + (a[1] - l) * k), Math.max(floor, l + (a[2] - l) * k)];
}

/**
 * THE LAMP IN A PAINT (REWRITE.md § B2 X1: "make it blue" turns the whole workshop's light
 * blue). Tuned by eye on the bench home, warm/blue/red/green (H1 round 3).
 *  - `key`: the paint's own hue, its chroma pushed `keySat` further (the neutral tone map and
 *    the grade wash a tinted key toward white: the old 18%-whitened tint read as cool white),
 *    at unit luminance, so a coloured lamp is as bright as the warm one: a coloured bulb, not
 *    a coloured spotlight;
 *  - the fill, the sky and the bounce follow `follow` of the way (shadows lean toward the
 *    lamp's colour instead of going grey against it), the ground bounce more;
 *  - `glow`: the hue the lamp's own lit parts take (bulb, liner, vents).
 */
export const LAMP_TINT = { keySat: 1.35, follow: 0.18, ground: 0.4, env: 0.6 };

export interface LampLighting {
  key: RGB;
  fill: RGB;
  hemiSky: RGB;
  hemiGround: RGB;
  bounce: RGB;
  rim: RGB;
  /** The environment's lamp panel. */
  envWarm: RGB;
  /** The lamp's own glow: its hue, and how far it replaces the bulb's amber (0 warm, 1 a paint). */
  glow: RGB;
  glowMix: number;
}

/** Every colour the light rig takes for a lamp colour: null is the lamp's own warm. */
export function lampLighting(token: Token | null): LampLighting {
  const c = stageColours();
  if (!token) return { key: c.key, fill: c.fill, hemiSky: c.hemiSky, hemiGround: c.hemiGround, bounce: c.bounce, rim: c.rim, envWarm: c.envWarm, glow: WHITE, glowMix: 0 };
  const key = unitLuminance(saturate(tok(token), LAMP_TINT.keySat));
  const towards = (a: RGB, t: number): RGB => unitLuminance(mix(a, key, t));
  return {
    key,
    fill: towards(c.fill, LAMP_TINT.follow),
    hemiSky: towards(c.hemiSky, LAMP_TINT.follow),
    hemiGround: towards(c.hemiGround, LAMP_TINT.ground),
    bounce: unitLuminance(mix(key, tok('wood-light'), 0.5)),
    rim: c.rim,
    envWarm: towards(c.envWarm, LAMP_TINT.env),
    glow: unitLuminance(saturate(tok(token), 1)),
    glowMix: 1,
  };
}

/** The key's colour for a lamp in a paint (lampLighting's `key`). */
export function lampColourFrom(token: Token): RGB {
  return lampLighting(token).key;
}

export interface StageColours {
  /** The lamp: amber-glow lightened a little, about 3200 K once tone mapped. Unit luminance. */
  key: RGB;
  /** The cool fill: teal-light cut with steel. Unit luminance. */
  fill: RGB;
  /** The window rim: steel pushed toward teal-light, cooler and paler than the fill. Unit luminance. */
  rim: RGB;
  /** Hemisphere sky (cool, from the room) and ground (warm bounce off the wood bench). Unit luminance. */
  hemiSky: RGB;
  hemiGround: RGB;
  /** Bounce off the lit bench: the key's warmth through the wood. Unit luminance. */
  bounce: RGB;
  /** The room: clear colour and fog. Exactly teal-deep. */
  room: RGB;
  /** What ambient occlusion darkens toward: teal, never grey (multiplier, 0..1 per channel). */
  occlusion: RGB;
  /** Split-tone grade: shadows lean toward this, lights toward the next (unit luminance). */
  gradeShadow: RGB;
  gradeLight: RGB;
  /** Environment panels: the warm lamp panel, the cool window panel, the room walls, the bench below. */
  envWarm: RGB;
  envCool: RGB;
  envRoom: RGB;
  envFloor: RGB;
  /** Blob contact shadows: a deep teal, darker than the room. */
  blob: RGB;
  /** Coloured shadows: the hue a surface takes where the key does not reach. Unit luminance. */
  shadowTint: RGB;
  /** The sign's bulbs on the wall: amber-glow, a touch deeper than the lamp. Unit luminance. */
  wash: RGB;
}

export function stageColours(): StageColours {
  const amberGlow = tok('amber-glow');
  const amber = tok('amber');
  const tealLight = tok('teal-light');
  const tealDeep = tok('teal-deep');
  const tealPanel = tok('teal-panel');
  const steel = tok('steel');
  const wood = tok('wood');
  const woodLight = tok('wood-light');

  const key = unitLuminance(mix(amberGlow, WHITE, 0.12));
  const fill = unitLuminance(mix(tealLight, steel, 0.3));
  const rim = unitLuminance(mix(steel, tealLight, 0.35));
  const hemiSky = unitLuminance(mix(tealLight, steel, 0.35));
  const hemiGround = unitLuminance(mix(wood, woodLight, 0.5));

  // AO multiplies by this at full occlusion: a teal-leaning darkening. Built
  // from teal-light's hue, brought to a luminance of about 0.38.
  const occlusionHue = unitLuminance(mix(tealLight, steel, 0.3));
  const occlusion = scale(occlusionHue, 0.38).map((c) => Math.min(c, 1)) as unknown as RGB;

  return {
    key,
    fill,
    rim,
    hemiSky,
    hemiGround,
    bounce: unitLuminance(mix(key, woodLight, 0.5)),
    room: tealDeep,
    occlusion,
    gradeShadow: unitLuminance(mix(tealLight, tealDeep, 0.3)),
    gradeLight: unitLuminance(mix(amber, amberGlow, 0.5)),
    envWarm: unitLuminance(mix(amberGlow, WHITE, 0.2)),
    envCool: unitLuminance(mix(steel, tealLight, 0.25)),
    envRoom: mix(tealDeep, tealPanel, 0.35),
    envFloor: scale(mix(wood, woodLight, 0.35), 0.45),
    blob: scale(tealDeep, 0.35),
    wash: unitLuminance(mix(amberGlow, amber, 0.3)),
    shadowTint: unitLuminance(mix(tealLight, tealDeep, 0.25)),
  };
}
