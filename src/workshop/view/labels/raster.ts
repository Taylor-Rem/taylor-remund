/**
 * Single-channel float images and the few operations the label registers
 * need (blur, displacement, height to normal). Pure; runs in Node, so the
 * maths is tested without a canvas. Rows run top to bottom, as on a canvas;
 * `toTextureRows` flips them for upload (texture v runs bottom to top).
 */
import type { Rng } from './rng.ts';
import { rng as makeRng } from './rng.ts';

export interface Gray {
  readonly w: number;
  readonly h: number;
  readonly d: Float32Array;
}

export function gray(w: number, h: number, fill = 0): Gray {
  const d = new Float32Array(w * h);
  if (fill !== 0) d.fill(fill);
  return { w, h, d };
}

export function clone(g: Gray): Gray {
  return { w: g.w, h: g.h, d: new Float32Array(g.d) };
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** One box-blur pass of radius r (in pixels, integer) along x then y; edges clamp. */
function boxPass(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return new Float32Array(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/** Approximately Gaussian blur (three box passes) with standard deviation `sigma` pixels. */
export function blur(g: Gray, sigma: number): Gray {
  if (sigma < 0.5) return clone(g);
  // Three boxes of width w give variance 3 * (w^2 - 1) / 12.
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  const r = Math.max(1, Math.round((wIdeal - 1) / 2));
  let d = boxPass(g.d, g.w, g.h, r);
  d = boxPass(d, g.w, g.h, r);
  d = boxPass(d, g.w, g.h, r);
  return { w: g.w, h: g.h, d };
}

/** Bilinear sample with clamped edges. */
export function sample(g: Gray, x: number, y: number): number {
  const xc = Math.min(g.w - 1, Math.max(0, x));
  const yc = Math.min(g.h - 1, Math.max(0, y));
  const x0 = Math.floor(xc);
  const y0 = Math.floor(yc);
  const x1 = Math.min(g.w - 1, x0 + 1);
  const y1 = Math.min(g.h - 1, y0 + 1);
  const fx = xc - x0;
  const fy = yc - y0;
  const a = g.d[y0 * g.w + x0]!;
  const b = g.d[y0 * g.w + x1]!;
  const c = g.d[y1 * g.w + x0]!;
  const e = g.d[y1 * g.w + x1]!;
  return lerp(lerp(a, b, fx), lerp(c, e, fx), fy);
}

/** Resample `g` at (x + dx(x,y), y + dy(x,y)). */
export function displace(g: Gray, dx: (x: number, y: number) => number, dy: (x: number, y: number) => number): Gray {
  const out = gray(g.w, g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) out.d[y * g.w + x] = sample(g, x + dx(x, y), y + dy(x, y));
  return out;
}

/** Translate by whole pixels; uncovered pixels become 0. */
export function shift(g: Gray, dx: number, dy: number): Gray {
  const out = gray(g.w, g.h);
  for (let y = 0; y < g.h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= g.h) continue;
    for (let x = 0; x < g.w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < g.w) out.d[y * g.w + x] = g.d[sy * g.w + sx]!;
    }
  }
  return out;
}

/** Per-pixel combination of images of the same size. */
export function map(out: Gray, f: (i: number) => number): Gray {
  for (let i = 0; i < out.d.length; i++) out.d[i] = f(i);
  return out;
}

/**
 * A normal map (RGBA bytes, rows top to bottom like the input) from a height
 * image in 0..1. `strength` scales the slope; tangent-space, +Y up in the
 * texture (OpenGL convention, what three.js expects with default normalScale).
 */
export function heightToNormal(hgt: Gray, strength: number): Uint8Array {
  const { w, h, d } = hgt;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const yu = Math.max(0, y - 1);
    const yd = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1);
      const xr = Math.min(w - 1, x + 1);
      // Sobel
      const tl = d[yu * w + xl]!, tc = d[yu * w + x]!, tr = d[yu * w + xr]!;
      const ml = d[y * w + xl]!, mr = d[y * w + xr]!;
      const bl = d[yd * w + xl]!, bc = d[yd * w + x]!, br = d[yd * w + xr]!;
      const gx = (tr + 2 * mr + br - tl - 2 * ml - bl) / 8;
      const gyDown = (bl + 2 * bc + br - tl - 2 * tc - tr) / 8; // dh/dy with y down the image
      // texture v runs up the image, so dh/dv = -gyDown
      let nx = -gx * strength;
      let ny = gyDown * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * w + x) * 4;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Flip RGBA rows in place (canvas rows top-down -> texture rows bottom-up). */
export function toTextureRows(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const stride = w * 4;
  const tmp = new Uint8Array(stride);
  for (let y = 0; y < h >> 1; y++) {
    const a = y * stride;
    const b = (h - 1 - y) * stride;
    tmp.set(rgba.subarray(a, a + stride));
    rgba.copyWithin(a, b, b + stride);
    rgba.set(tmp, b);
  }
  return rgba;
}

/** Halve an RGBA image (2x2 box filter; an odd last row/column is folded in). */
export function halve(rgba: Uint8Array, w: number, h: number): { data: Uint8Array; w: number; h: number } {
  const hw = Math.max(1, w >> 1);
  const hh = Math.max(1, h >> 1);
  const out = new Uint8Array(hw * hh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0;
        let n = 0;
        for (let yy = y * 2; yy < Math.min(h, y * 2 + (y === hh - 1 ? 3 : 2)); yy++) {
          for (let xx = x * 2; xx < Math.min(w, x * 2 + (x === hw - 1 ? 3 : 2)); xx++) {
            s += rgba[(yy * w + xx) * 4 + c]!;
            n++;
          }
        }
        out[(y * hw + x) * 4 + c] = Math.round(s / n);
      }
    }
  }
  return { data: out, w: hw, h: hh };
}

// ---- noise -------------------------------------------------------------

export type Noise2 = (x: number, y: number) => number;

/** Smooth value noise in [0, 1] on a unit lattice, seeded. */
export function valueNoise(seed: number | string): Noise2 {
  const r: Rng = makeRng(seed);
  const N = 256;
  const perm = new Uint16Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    perm[i] = i;
    vals[i] = r();
  }
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i]!;
  const v = (ix: number, iy: number): number => vals[perm[(perm[ix & 255]! + iy) & 511]!]!;
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(v(ix, iy), v(ix + 1, iy), sx), lerp(v(ix, iy + 1), v(ix + 1, iy + 1), sx), sy);
  };
}

/** Fractal sum of value noise, normalised to [0, 1]. */
export function fbm(seed: number | string, octaves = 4): Noise2 {
  const layers = Array.from({ length: octaves }, (_, i) => valueNoise(`${seed}/${i}`));
  let norm = 0;
  for (let i = 0; i < octaves; i++) norm += 0.5 ** i;
  return (x, y) => {
    let s = 0;
    let f = 1;
    let a = 1;
    for (const n of layers) {
      s += n(x * f, y * f) * a;
      f *= 2.03;
      a *= 0.5;
    }
    return s / norm;
  };
}
