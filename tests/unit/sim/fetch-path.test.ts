// S5 round 2: Fetch on a lane of several runs (an L of three points, a U of four), on the stub physics:
// it rides end to end, eases round each corner (slowing into it, heading and speed true throughout), returns
// to the nearest point of its path when set down beside a far run, and when knocked near a corner.
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from './helpers.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import { lanePath } from '../../../src/workshop/sim/path.ts';
import type { Pt } from '../../../src/workshop/sim/path.ts';
import { HZ, steps } from '../../../src/workshop/sim/clock.ts';
import type { SceneDesc } from '../../../src/workshop/sim/scene.ts';
import type { SimEvent } from '../../../src/workshop/sim/types.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { StubPhysics } from '../../../src/workshop/sim/physics/stub.ts';

const PATHS: Record<string, Pt[]> = {
  L: [[-3.7, 2.25], [2.5, 2.25], [2.5, -1.0]],
  U: [[-3.7, 2.25], [3.0, 2.25], [3.0, -0.8], [-0.5, -0.8]],
};
const sceneOf = (pts: Pt[]): SceneDesc => ({ ...vignette, id: `vignette-${pts.length}`, runner: { ...vignette.runner, lane: { points: pts } } });
const pathOf = (pts: Pt[]) => lanePath(pts, FETCH_TUNING.cornerRadius);
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** How far (x, z) is from the path. */
const off = (pts: Pt[], x: number, z: number): number => {
  const p = pathOf(pts);
  const q = p.at(p.nearest(x, z));
  return Math.hypot(q[0] - x, q[1] - z);
};
/** Keep the visitor "present" (no fumble) without starting play mode. */
const stir = (w: World, i: number): void => {
  if (i % steps(2) === 0) w.dispatch({ type: 'hover', id: null });
};

describe.each(Object.entries(PATHS))('Fetch on a path: %s', (name, pts) => {
  const path = pathOf(pts);

  test(`${name}: it rides end to end, always on its path, heading true, and slows into every corner`, () => {
    const { world: w } = stubWorld(1, { scene: sceneOf(pts) });
    let minS = Infinity;
    let maxS = -Infinity;
    let lastHeading = w.crew('fetch')!.heading;
    let cornerTop = 0;
    let fastest = 0;
    for (let i = 0; i < steps(60); i++) {
      stir(w, i);
      run(w, 1);
      const f = w.crew('fetch')!;
      expect(w.playMode).toBe(false);
      if (f.state === 'roll' || f.state === 'skid' || f.state === 'idle') {
        expect(off(pts, f.x, f.z), `${f.state} at ${f.x.toFixed(3)}, ${f.z.toFixed(3)}`).toBeLessThan(1e-6);
        const s = path.nearest(f.x, f.z);
        minS = Math.min(minS, s);
        maxS = Math.max(maxS, s);
        if (path.corners.some((c) => s > c.s0 + 1e-6 && s < c.s1 - 1e-6)) cornerTop = Math.max(cornerTop, Math.abs(f.speed));
        fastest = Math.max(fastest, Math.abs(f.speed));
      }
      // the heading never snaps: no faster than its turn rate
      expect(Math.abs(wrap(f.heading - lastHeading))).toBeLessThanOrEqual(FETCH_TUNING.turnRate / HZ + 1e-9);
      lastHeading = f.heading;
    }
    // end to end (the stops are `inset` in from the ends)
    expect(minS).toBeLessThan(FETCH_TUNING.inset + 0.05);
    expect(maxS).toBeGreaterThan(path.length - FETCH_TUNING.inset - 0.05);
    // round each corner no faster than the corner speed, though it runs faster on the straight
    expect(cornerTop).toBeGreaterThan(0);
    expect(cornerTop).toBeLessThanOrEqual(FETCH_TUNING.cornerSpeed + 1e-6);
    expect(fastest).toBeGreaterThan(FETCH_TUNING.cornerSpeed * 1.5);
  });

  test(`${name}: picked up and set down beside its far run, it goes back to the nearest point of its path (on that run), turning the shorter way`, () => {
    const { world: w } = stubWorld(1, { scene: sceneOf(pts) });
    run(w, 10);
    const last = pts[pts.length - 1]!;
    const prev = pts[pts.length - 2]!;
    // beside the middle of the last run, 0.8 off it
    const mid: Pt = [(last[0] + prev[0]) / 2, (last[1] + prev[1]) / 2];
    const dir = [last[0] - prev[0], last[1] - prev[1]];
    const len = Math.hypot(dir[0]!, dir[1]!);
    const side: Pt = [mid[0] + (-dir[1]! / len) * 0.8, mid[1] + (dir[0]! / len) * 0.8];
    w.dispatch({ type: 'grab', id: 'fetch', grip: w.motion('fetch')!.pose.p });
    run(w, 1);
    for (let i = 0; i < 40; i++) {
      w.dispatch({ type: 'carry', target: [side[0], 1.2, side[1]] });
      run(w, 1);
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    let turned = 0;
    let lastHeading = NaN;
    let back = false;
    let landed: Pt | null = null;
    for (let i = 0; i < steps(8) && !back; i++) {
      run(w, 1);
      const f = w.crew('fetch')!;
      if (f.state === 'return' && landed === null) landed = [f.x, f.z];
      if (f.state === 'return' || f.state === 'idle') {
        if (!Number.isNaN(lastHeading)) turned += Math.abs(wrap(f.heading - lastHeading));
        lastHeading = f.heading;
      }
      if (f.state === 'idle' && off(pts, f.x, f.z) < 1e-6 && f.stateTime > 0.5) back = true;
    }
    expect(back).toBe(true);
    const f = w.crew('fetch')!;
    // on the last run, at the point of its path nearest where it came down
    expect(landed).not.toBeNull();
    const at = path.at(path.nearest(landed![0], landed![1]));
    expect(Math.hypot(f.x - at[0], f.z - at[1])).toBeLessThan(1e-6);
    expect(Math.hypot(f.x - mid[0], f.z - mid[1])).toBeLessThan(0.3);
    // the shorter way: never more than a quarter turn going back plus a quarter turn squaring up
    expect(turned).toBeLessThanOrEqual(Math.PI + 1e-6);
  });

  test(`${name}: knocked near a corner, it slides, recovers, and returns to its path`, () => {
    const { world: w, physics } = stubWorld(1, { scene: sceneOf(pts) });
    // wait until it is near the first corner
    const c = path.corners[0]!;
    let near = false;
    for (let i = 0; i < steps(40) && !near; i++) {
      stir(w, i);
      run(w, 1);
      const f = w.crew('fetch')!;
      const s = path.nearest(f.x, f.z);
      if ((f.state === 'roll' || f.state === 'idle') && s > c.s0 - 0.5 && s < c.s1 + 0.5) near = true;
    }
    expect(near).toBe(true);
    const ev = hitFetch(w, physics, 'crate-1', 6, 2);
    expect(ev.some((e) => e.type === 'crew.knocked')).toBe(true);
    let back = false;
    for (let i = 0; i < steps(6) && !back; i++) {
      stir(w, i);
      run(w, 1);
      const f = w.crew('fetch')!;
      if (f.state !== 'knocked' && f.state !== 'return') back = off(pts, f.x, f.z) < 1e-6;
    }
    expect(back).toBe(true);
  });
});

/** Send `id` sliding at Fetch for a few steps (stub physics), then report a contact between them. */
function hitFetch(world: World, physics: StubPhysics, id: string, speed: number, impulse = 1): SimEvent[] {
  const f = world.crew('fetch')!;
  const n = 8;
  const from = 0.7 + (speed * n) / 60;
  // from the side the path is not on (straight across its heading)
  const dx = Math.cos(f.heading);
  const dz = -Math.sin(f.heading);
  physics.setPose(id, { p: [f.x - dx * from, 0.6, f.z - dz * from], q: [0, 0, 0, 1] });
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    physics.setVelocity(id, [dx * speed, 0, dz * speed]);
    physics.wake(id);
    out.push(...run(world, 1));
  }
  physics.contact({ a: id, b: 'fetch', impulse });
  out.push(...run(world, 2));
  return out;
}
