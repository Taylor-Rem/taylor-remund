/**
 * The shared noise volume: four independent tileable 3D gradient-noise
 * fields baked once at start into a small RGBA8 3D texture, so a noise
 * lookup in a shader is one filtered texture fetch (giving four fields)
 * instead of ~150 ALU operations per field. Deterministic: the lattice gradients come from an integer hash
 * of the seed, never from Math.random.
 *
 * Layout: SIZE texels per side covering PERIOD lattice cells, so a shader
 * reads `texture(tex, x / PERIOD)` for noise of frequency 1 in `x` units.
 */
import { Data3DTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

export const NOISE_SIZE = 64;
export const NOISE_PERIOD = 16;

function hashInt(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(seed, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** One tileable gradient-noise field, NOISE_SIZE^3 floats around 0.5. */
function bakeField(seed: number): Float32Array {
  const P = NOISE_PERIOD;
  const grads = new Float32Array(P * P * P * 3);
  for (let z = 0; z < P; z++)
    for (let y = 0; y < P; y++)
      for (let x = 0; x < P; x++) {
        const i = ((z * P + y) * P + x) * 3;
        const h = hashInt(x, y, z, seed);
        const a = ((h & 1023) / 1023) * Math.PI * 2;
        const cz = (((h >>> 10) & 1023) / 1023) * 2 - 1;
        const r = Math.sqrt(1 - cz * cz);
        grads[i] = r * Math.cos(a);
        grads[i + 1] = r * Math.sin(a);
        grads[i + 2] = cz;
      }
  const N = NOISE_SIZE;
  const step = P / N;
  const out = new Float32Array(N * N * N);
  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const M = P - 1;
  const dotG = (ix: number, iy: number, iz: number, fx: number, fy: number, fz: number): number => {
    const i = (((iz & M) * P + (iy & M)) * P + (ix & M)) * 3; // P is a power of two
    return grads[i]! * fx + grads[i + 1]! * fy + grads[i + 2]! * fz;
  };
  for (let z = 0; z < N; z++) {
    const pz = (z + 0.5) * step, iz = Math.floor(pz), fz = pz - iz, w = fade(fz);
    for (let y = 0; y < N; y++) {
      const py = (y + 0.5) * step, iy = Math.floor(py), fy = py - iy, v = fade(fy);
      for (let x = 0; x < N; x++) {
        const px = (x + 0.5) * step, ix = Math.floor(px), fx = px - ix, u = fade(fx);
        const d000 = dotG(ix, iy, iz, fx, fy, fz), d100 = dotG(ix + 1, iy, iz, fx - 1, fy, fz);
        const d010 = dotG(ix, iy + 1, iz, fx, fy - 1, fz), d110 = dotG(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz);
        const d001 = dotG(ix, iy, iz + 1, fx, fy, fz - 1), d101 = dotG(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1);
        const d011 = dotG(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1), d111 = dotG(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1);
        const x00 = d000 + (d100 - d000) * u, x10 = d010 + (d110 - d010) * u;
        const x01 = d001 + (d101 - d001) * u, x11 = d011 + (d111 - d011) * u;
        const y0 = x00 + (x10 - x00) * v;
        const y1 = x01 + (x11 - x01) * v;
        out[(z * N + y) * N + x] = 0.5 + 0.85 * (y0 + (y1 - y0) * w);
      }
    }
  }
  return out;
}

/** The raw RGBA8 volume: four independent fields, one per channel (exported for tests). */
export function bakeNoise(seed = 7): Uint8Array {
  const N = NOISE_SIZE;
  const out = new Uint8Array(N * N * N * 4);
  for (let c = 0; c < 4; c++) {
    const f = bakeField(seed * 4 + c + 1);
    for (let i = 0; i < f.length; i++) out[i * 4 + c] = Math.round(Math.min(1, Math.max(0, f[i]!)) * 255);
  }
  return out;
}

export function createNoiseTexture(seed = 7): Data3DTexture {
  const tex = new Data3DTexture(bakeNoise(seed), NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearMipmapLinearFilter; // far away, noise averages out instead of sparkling // far away, noise averages out instead of sparkling
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
