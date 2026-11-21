// Fetch in front of the things a visitor presses: helpers for the sight-line scan (fetch-sight.test.ts).
//
// A handle is "hidden" by Fetch while the straight line from its middle to the visitor's eye passes through Fetch's
// body (its box on its wheels, turned by its heading, a hair grown: the pick's padding) or through the crate in its
// hands. Two eyes: the scene's visitor (`PATCHLAMP.patch.visitor`, what Patch looks at; low, about at the bench's
// height 14 out in front) and the page's camera at its home framing on a 1440 x 900 window (the view's CameraRig:
// pitch 33, fov 20, the bench's box fitted; from (0, 25.13, 32.51); a portrait phone's camera looks down the same
// line from further out). A handle counts as hidden when either eye's line is cut.
import { PATCHLAMP, AT } from '../../src/workshop/sim/scenes/bench.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Quat, Vec3 } from '../../src/workshop/sim/types.ts';

export const EYES: Record<string, Vec3> = {
  visitor: PATCHLAMP.patch.visitor,
  camera: [0, 25.13, 32.51],
};

/**
 * The middle of each thing a visitor presses (world). The phone, the UNDO lever's plate and its grip, the Button's cap
 * are the scene's own numbers; the belt's dial and lever sit on its motor housing (`AT.beltMotor`'s top), the bell over
 * the dock's door, the lamp's shade high under the wall rail: approximate, and far from anywhere Fetch can stand
 * (in front of its tape, beyond its tape's right end, high above it).
 */
export const HANDLES: Record<string, Vec3> = {
  phone: AT.phone.c as unknown as Vec3,
  'undo plate': AT.undo.c as unknown as Vec3,
  'undo grip': PATCHLAMP.patch.lever,
  button: AT.buttonCap,
  'belt dial': [AT.beltMotor.c[0] - 0.3, AT.beltMotor.c[1] + AT.beltMotor.half[1], AT.beltMotor.c[2]],
  'belt lever': [AT.beltMotor.c[0] + 0.3, AT.beltMotor.c[1] + AT.beltMotor.half[1], AT.beltMotor.c[2]],
  bell: [AT.dockDoor[0], 2.4, AT.dockDoor[1]],
  lamp: [-1.5, 4.5, -3],
};

/** Does the segment a→b pass through the box at `c` (half extents `h`, turned by `q`)? (slab test in the box's frame) */
function segmentHitsBox(a: Vec3, b: Vec3, c: Vec3, h: Vec3, q: Quat): boolean {
  const inv = (v: Vec3): Vec3 => {
    // rotate v by the conjugate of q
    const [qx, qy, qz, qw] = [-q[0], -q[1], -q[2], q[3]];
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
  };
  const p = inv([a[0] - c[0], a[1] - c[1], a[2] - c[2]]);
  const e = inv([b[0] - c[0], b[1] - c[1], b[2] - c[2]]);
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = (e[i] as number) - (p[i] as number);
    const lo = -(h[i] as number) - (p[i] as number);
    const hi = (h[i] as number) - (p[i] as number);
    if (Math.abs(d) < 1e-12) {
      if (lo > 0 || hi < 0) return false;
      continue;
    }
    let ta = lo / d;
    let tb = hi / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

const PAD = 0.03;
/** Fetch's body and the crate in its hands, as boxes (none while it is in the hand, flying on its jets, gone). */
function fetchBoxes(w: World): { c: Vec3; h: Vec3; q: Quat }[] {
  const m = w.motion('fetch');
  const h = w.halfExtents('fetch');
  if (!m || !h || m.mode === 'gone' || m.mode === 'chute' || m.mode === 'held') return [];
  const out = [{ c: m.pose.p as Vec3, h: [h[0] + PAD, h[1] + PAD, h[2] + PAD] as Vec3, q: m.pose.q as Quat }];
  const c = w.crew('fetch')?.carrying;
  const cm = c ? w.motion(c) : undefined;
  const ch = c ? w.halfExtents(c) : undefined;
  if (cm && ch) out.push({ c: cm.pose.p as Vec3, h: [ch[0] + PAD, ch[1] + PAD, ch[2] + PAD] as Vec3, q: cm.pose.q as Quat });
  return out;
}

/** Every handle seen from every eye: "phone (camera)", "phone (visitor)", ... */
export const SIGHTS: readonly string[] = Object.keys(HANDLES).flatMap((h) => Object.keys(EYES).map((e) => `${h} (${e})`));

/** Which handles Fetch hides now, from which eye ("phone (camera)"). */
export function hidden(w: World): Set<string> {
  const boxes = fetchBoxes(w);
  const out = new Set<string>();
  if (!boxes.length) return out;
  for (const [name, p] of Object.entries(HANDLES)) for (const [e, eye] of Object.entries(EYES)) if (boxes.some((b) => segmentHitsBox(p, eye, b.c, b.h, b.q))) out.add(`${name} (${e})`);
  return out;
}

/** A stretch a handle stood hidden: how long, from when, where Fetch was, and what it was doing (its states, with time in each). */
export interface Stretch {
  readonly handle: string;
  readonly seconds: number;
  readonly from: number;
  readonly at: [number, number];
  readonly what: string;
}

/**
 * A watcher for one world: call `step()` after every `advance()`. Keeps, per handle, the longest stretch it stood hidden
 * without a break (`worst`), and the longest in which, besides, Fetch stood still at every step (`worstStill`: it moved
 * less than 2 mm on the bench in each step; turning on the spot is standing still).
 */
export function sightWatch(w: World, extra?: () => string) {
  // (while a Button rung plays nothing on the bench can be pressed, § B4, and Fetch plays its fright where it stands:
  // those steps are not counted, and end a stretch)
  type Run = { from: number; what: Map<string, number>; at: [number, number] };
  const runs = { any: new Map<string, Run>(), still: new Map<string, Run>() };
  const best = { any: new Map<string, Stretch>(), still: new Map<string, Stretch>() };
  let last: Vec3 | null = null;
  const close = (kind: 'any' | 'still', name: string, r: Run): void => {
    const seconds = (w.step - r.from) / HZ;
    const what = [...r.what.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${(n / HZ).toFixed(1)}s`).join(', ');
    if (seconds > (best[kind].get(name)?.seconds ?? 0)) best[kind].set(name, { handle: name, seconds, from: r.from / HZ, at: r.at, what });
  };
  return {
    step(): void {
      const m = w.motion('fetch');
      const p = (m?.pose.p ?? [0, 0, 0]) as Vec3;
      const moved = last ? Math.hypot(p[0] - last[0], p[2] - last[2]) : 0;
      last = [p[0], p[1], p[2]];
      const now = w.bracketed ? new Set<string>() : hidden(w);
      const f = w.crew('fetch');
      const key = `${f?.state}${f?.carrying ? '+crate' : ''}${extra ? extra() : ''}`;
      for (const name of SIGHTS) {
        for (const kind of ['any', 'still'] as const) {
          const on = now.has(name) && (kind === 'any' || moved < 0.002);
          const r = runs[kind].get(name);
          if (on) {
            if (!r) runs[kind].set(name, { from: w.step, what: new Map([[key, 1]]), at: [p[0], p[2]] });
            else r.what.set(key, (r.what.get(key) ?? 0) + 1);
          } else if (r) {
            close(kind, name, r);
            runs[kind].delete(name);
          }
        }
      }
    },
    /** Close the stretches still open and give the longest per handle. */
    done(): { worst: Map<string, Stretch>; worstStill: Map<string, Stretch> } {
      for (const kind of ['any', 'still'] as const) {
        for (const [name, r] of runs[kind]) close(kind, name, r);
        runs[kind].clear();
      }
      return { worst: best.any, worstStill: best.still };
    },
  };
}
