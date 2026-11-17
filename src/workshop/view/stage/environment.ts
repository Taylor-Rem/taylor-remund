/**
 * The generated environment (art-direction § 4): what brass and enamel
 * reflect. No downloaded HDRI and no extra scene: an equirectangular
 * radiance map is computed in code (a dark teal room, a big warm soft panel
 * where the lamp is, a tall cool panel where the window is, the warm-dark
 * bench below) and prefiltered with PMREM.
 *
 * Directions follow three's equirect convention:
 *   u = atan(dir.z, dir.x) / 2π + 0.5,  v = asin(dir.y) / π + 0.5.
 */
import {
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  PMREMGenerator,
  RGBAFormat,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { stageColours, type RGB } from './colours.ts';

/** A soft rectangle on the sphere, given by the direction of its centre and its angular half-sizes. */
export interface EnvPanel {
  /** Direction toward the panel centre (need not be unit). */
  dir: readonly [number, number, number];
  /** Half width (around the vertical axis) and half height, radians. */
  halfW: number;
  halfH: number;
  /** Edge softness, radians. */
  soft: number;
  colour: RGB;
  intensity: number;
}

export interface EnvOptions {
  width?: number;
  /** The lamp panel direction from the bench centre (toward the bulb). */
  lampDir?: readonly [number, number, number];
  /** The window panel direction. */
  windowDir?: readonly [number, number, number];
  lampIntensity?: number;
  windowIntensity?: number;
  roomIntensity?: number;
}

function norm(d: readonly [number, number, number]): [number, number, number] {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Radiance in one direction (linear rgb). Exported for tests. */
export function envRadiance(dir: readonly [number, number, number], panels: readonly EnvPanel[], room: RGB, floor: RGB, roomIntensity: number): RGB {
  const [x, y, z] = norm(dir);
  // The room: dark teal, a touch lighter toward the horizon, the bench's warm dark below.
  const up = smoothstep(-0.25, 0.15, y);
  const horizon = 1 - Math.abs(y);
  let r = (floor[0] + (room[0] - floor[0]) * up) * roomIntensity * (0.7 + 0.5 * horizon);
  let g = (floor[1] + (room[1] - floor[1]) * up) * roomIntensity * (0.7 + 0.5 * horizon);
  let b = (floor[2] + (room[2] - floor[2]) * up) * roomIntensity * (0.7 + 0.5 * horizon);
  const az = Math.atan2(z, x);
  const el = Math.asin(Math.max(-1, Math.min(1, y)));
  for (const p of panels) {
    const [px, py, pz] = norm(p.dir);
    const paz = Math.atan2(pz, px);
    const pel = Math.asin(py);
    let daz = Math.abs(az - paz);
    if (daz > Math.PI) daz = 2 * Math.PI - daz;
    const del = Math.abs(el - pel);
    const w = (1 - smoothstep(p.halfW - p.soft, p.halfW + p.soft, daz)) * (1 - smoothstep(p.halfH - p.soft, p.halfH + p.soft, del));
    if (w <= 0) continue;
    // A panel is a little brighter in its middle, like a lit shade or a window with sky.
    const core = 0.75 + 0.25 * (1 - Math.min(1, Math.hypot(daz / p.halfW, del / p.halfH)));
    r += p.colour[0] * p.intensity * w * core;
    g += p.colour[1] * p.intensity * w * core;
    b += p.colour[2] * p.intensity * w * core;
  }
  return [r, g, b];
}

export function defaultPanels(opts: EnvOptions = {}): EnvPanel[] {
  const c = stageColours();
  return [
    {
      dir: opts.lampDir ?? [-0.42, 0.78, -0.2],
      halfW: 0.3,
      halfH: 0.18,
      soft: 0.1,
      colour: c.envWarm,
      intensity: opts.lampIntensity ?? 5,
    },
    {
      dir: opts.windowDir ?? [0.9, 0.38, -0.32],
      halfW: 0.16,
      halfH: 0.5,
      soft: 0.06,
      colour: c.envCool,
      intensity: opts.windowIntensity ?? 20,
    },
  ];
}

/** The equirect radiance map as RGBA float data, width × width/2. */
export function envData(opts: EnvOptions = {}): { data: Float32Array; width: number; height: number } {
  const width = opts.width ?? 256;
  const height = width / 2;
  const c = stageColours();
  const panels = defaultPanels(opts);
  const roomI = opts.roomIntensity ?? 3.5;
  const data = new Float32Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const v = (j + 0.5) / height;
    const theta = (v - 0.5) * Math.PI;
    const cy = Math.sin(theta);
    const cr = Math.cos(theta);
    for (let i = 0; i < width; i++) {
      const u = (i + 0.5) / width;
      const phi = (u - 0.5) * 2 * Math.PI;
      const rad = envRadiance([Math.cos(phi) * cr, cy, Math.sin(phi) * cr], panels, c.envRoom, c.envFloor, roomI);
      const k = (j * width + i) * 4;
      data[k] = rad[0];
      data[k + 1] = rad[1];
      data[k + 2] = rad[2];
      data[k + 3] = 1;
    }
  }
  return { data, width, height };
}

/** Build the prefiltered environment. The caller owns the result: call `dispose()` when done. */
export function buildEnvironment(renderer: WebGLRenderer, opts: EnvOptions = {}): { texture: Texture; dispose(): void } {
  const { data, width, height } = envData(opts);
  const eq = new DataTexture(data, width, height, RGBAFormat, FloatType);
  eq.mapping = EquirectangularReflectionMapping;
  eq.magFilter = LinearFilter;
  eq.minFilter = LinearFilter;
  eq.needsUpdate = true;
  const pmrem = new PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(eq);
  pmrem.dispose();
  eq.dispose();
  return { texture: rt.texture, dispose: () => rt.dispose() };
}
