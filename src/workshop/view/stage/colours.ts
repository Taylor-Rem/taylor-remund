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

/** A light colour for the lamp when the simulation recolours it (setLamp colour), lightened like the key. */
export function lampColourFrom(token: Token): RGB {
  return unitLuminance(mix(tok(token), WHITE, 0.18));
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
