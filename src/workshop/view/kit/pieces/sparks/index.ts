/**
 * Sparks (REWRITE.md § B4 rung 4 "sparks"; W3 round 2). Registry name
 * `sparks`.
 *
 * Eight short streaks of the bulb class thrown from a point: hot white-amber
 * at the head, each a thin tapered sliver along its own +Y. Each streak is a
 * node (`spark0`..`spark7`), shown by scale (drawing is skinned: nothing is
 * ever hidden, only shrunk into itself), placed and aimed along its flight by
 * `poseSparks`: a seeded burst, thrown up and outward, falling under gravity,
 * stretched by its speed, shrinking as it cools. Pure: a time and a seed in,
 * node transforms out.
 *
 * Local frame: the burst's origin at (0, 0, 0); +Y up. About 60 triangles.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { KitOptions, Piece } from '../../types.ts';
import type { CatalogueEntry } from '../../catalogue.ts';
import { stud } from '../../cheap.ts';
import { deform } from '../../deform.ts';
import { noShadow, part, piece } from '../../compose.ts';
import { rng } from '../../rng.ts';
import { setFinish } from '../../space.ts';

export const SPARKS = {
  /** How many streaks. */
  n: 8,
  /** A streak's length at rest, and how much its speed stretches it (units per unit/s). */
  len: 0.07,
  stretch: 0.03,
  /** Launch speed range (units/s), how far off vertical (radians), gravity (units/s²). */
  speed: [1.4, 3.0] as readonly [number, number],
  spread: 1.2,
  gravity: 9,
  /** Each streak lives this long (s): it is at full size for the first part, then cools away. */
  life: [0.32, 0.6] as readonly [number, number],
} as const;

/** Scale of a streak that is not there. */
export const HIDDEN = 1e-4;

export interface SparksPose {
  /** Seconds since the burst (negative or past every streak's life: nothing shown). */
  t: number;
  /** The burst's seed (each burst throws differently). */
  seed?: number;
  /** A direction to favour (local), e.g. away from the machine; default straight up. */
  bias?: readonly [number, number, number];
}

export interface SparksOptions extends KitOptions {
  /** A still for the catalogue: the burst at this time (default 0.12 s). */
  t?: number;
}

export function sparks(o: SparksOptions = {}): Piece {
  const seed = o.seed ?? 1;
  const b = piece('sparks', { detail: o.detail ?? 'high', seed });
  const R = rng(seed);
  for (let i = 0; i < SPARKS.n; i++) {
    const n = b.node(`spark${i}`, new Matrix4().makeScale(HIDDEN, HIDDEN, HIDDEN));
    // a thin sliver, fat at the head (+Y) and drawn out to a point at the tail; each a little different
    const w = SPARKS.len * R.range(0.08, 0.12);
    const g = deform(stud(1, 1, 3), (x, y, z) => [x * w * (0.25 + 0.75 * y), (y - 1) * SPARKS.len, z * w * (0.25 + 0.75 * y)]);
    // lamp level (it blooms); one token for all, so the burst is one draw
    n.add(noShadow(setFinish(part('bulb', g, 'amber-glow', { seed: seed + i, jitter: 0.12 }), 0)));
  }
  const built = b.build();
  posePieceSparks(built, { t: o.t ?? 0.12, seed });
  return built;
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpS = new Vector3();
const UP = new Vector3(0, 1, 0);

/** One streak's matrix at time t of a burst. */
export function sparkMatrix(i: number, pose: SparksPose, out: Matrix4): Matrix4 {
  const R = rng(((pose.seed ?? 1) * 7919 + i * 104729) >>> 0);
  const speed = R.range(SPARKS.speed[0], SPARKS.speed[1]);
  const life = R.range(SPARKS.life[0], SPARKS.life[1]);
  const az = R.range(0, Math.PI * 2);
  const off = R.range(0.25, 1) * SPARKS.spread;
  const delay = R.range(0, 0.06);
  const t = pose.t - delay;
  if (!(t > 0) || t > life) return out.makeScale(HIDDEN, HIDDEN, HIDDEN);
  const b = pose.bias ?? [0, 1, 0];
  // launch direction: off vertical by `off`, round by `az`, leaning toward the bias
  let vx = Math.sin(off) * Math.cos(az) + b[0] * 0.8;
  let vy = Math.cos(off) + b[1] * 0.3;
  let vz = Math.sin(off) * Math.sin(az) + b[2] * 0.8;
  const l = Math.hypot(vx, vy, vz) || 1;
  vx = (vx / l) * speed;
  vy = (vy / l) * speed;
  vz = (vz / l) * speed;
  const px = vx * t, py = vy * t - 0.5 * SPARKS.gravity * t * t, pz = vz * t;
  // velocity now: the streak lies along it, its head forward
  const cy = vy - SPARKS.gravity * t;
  tmpV.set(vx, cy, vz);
  const v = tmpV.length();
  tmpQ.setFromUnitVectors(UP, tmpV.multiplyScalar(1 / Math.max(1e-4, v)));
  // full size, then it cools and shrinks over the last 40% of its life
  const cool = Math.min(1, Math.max(0, (life - t) / (life * 0.4)));
  const len = (1 + (SPARKS.stretch * v) / SPARKS.len) * cool;
  tmpS.set(cool, Math.max(HIDDEN, len), cool);
  return out.compose(tmpV.set(px, py, pz), tmpQ, tmpS);
}

const M = new Matrix4();
interface Posable {
  getObjectByName(name: string): { position: Vector3; quaternion: Quaternion; scale: Vector3 } | undefined;
}
const NAMES = Array.from({ length: SPARKS.n }, (_, i) => `spark${i}`);

/** Pose a realised burst at time `pose.t`. No allocation. Returns false once every streak is gone. */
export function poseSparks(root: Posable, pose: SparksPose): boolean {
  let any = false;
  for (let i = 0; i < SPARKS.n; i++) {
    sparkMatrix(i, pose, M);
    const o = root.getObjectByName(NAMES[i]!);
    if (o) M.decompose(o.position, o.quaternion, o.scale);
    if (o && o.scale.y > HIDDEN * 2) any = true;
  }
  return any;
}

function posePieceSparks(p: Piece, pose: SparksPose): void {
  for (const n of p.root.children ?? []) {
    const i = NAMES.indexOf(n.name);
    if (i >= 0) n.transform = sparkMatrix(i, pose, new Matrix4());
  }
}

export const catalogue: CatalogueEntry[] = [
  {
    name: 'sparks',
    build: (opts = {}) =>
      sparks({
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.detail ? { detail: opts.detail } : {}),
        t: typeof opts['t'] === 'number' ? (opts['t'] as number) : 0.12,
      }),
    variants: { early: { t: 0.05 }, late: { t: 0.3 }, 'seed 2': { seed: 2 } },
    camera: { distance: 1.4 },
    note: 'Sparks: eight streaks thrown from a point with gravity, seeded; a station misfiring hard on rung 4.',
  },
];
