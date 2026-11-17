/**
 * Colour helpers for painting label textures. Every colour comes from a
 * palette token; these only mix, darken and lighten them (sRGB bytes,
 * because the textures are authored as sRGB pictures, as a painter would).
 * Pure; runs in Node.
 */
import { hex } from '../palette.ts';
import type { Token } from '../palette.ts';

export type RGB = readonly [number, number, number];

export function rgb(token: Token): RGB {
  const n = parseInt(hex(token).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(a: RGB, k: number): RGB {
  return [a[0] * k, a[1] * k, a[2] * k];
}

/** Write a colour and alpha (0..1) into an RGBA byte array at pixel i. */
export function put(out: Uint8Array, i: number, c: RGB, a = 1): void {
  const o = i * 4;
  out[o] = c[0] < 0 ? 0 : c[0] > 255 ? 255 : c[0];
  out[o + 1] = c[1] < 0 ? 0 : c[1] > 255 ? 255 : c[1];
  out[o + 2] = c[2] < 0 ? 0 : c[2] > 255 ? 255 : c[2];
  out[o + 3] = Math.round((a < 0 ? 0 : a > 1 ? 1 : a) * 255);
}
