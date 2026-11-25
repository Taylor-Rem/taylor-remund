// P4 S6 round three: the lead's fault. A crate open on the stand, lifted and let go again over the same stand, leaning or
// over an edge (the camera still moving: a short drag in the close view): it was squared up in the middle of the deck and
// then nothing opened it, nor set it beside. From open on the stand: lifted and let go over each edge and each corner, with
// the dial turned first or not, with a look held or not (the sim knows no camera: a look is the page's; the world sees the
// same either way, so both are the same run here, said once). And the rule as a test of its own: no shut project crate is
// at rest on the deck for more than a second, whatever put it there; it opens, or it is set beside the stand.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape, putOn, BENCH, type Tape } from './line-helpers.ts';
import { STAND_STATION_SIZE, withOpeningStand, PAINT } from '../../src/workshop/sim/scenes/bench.ts';
import { OPEN } from '../../src/workshop/sim/machines/crates.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { Vec3 } from '../../src/workshop/sim/types.ts';

// the station size at a (the owner's layout puts it at the front of centre, the same size: its numbers are L2's)
const scene = withOpeningStand(BENCH, 'a', 'fixed', STAND_STATION_SIZE);
const S = scene.statics.find((s) => s.id === 'opening-stand')!;
const half = (S.shape as { half: Vec3 }).half;
const TOP: Vec3 = [S.pose.p[0], S.pose.p[1] + half[1], S.pose.p[2]];
const C = 'crate-3';

/** A shut project crate at rest on the deck (its middle over it), for how many steps in a row: the longest seen. */
function watch(w: World, t: Tape, n: number): number {
  let run = 0, worst = 0;
  for (let i = 0; i < n; i++) {
    t.run(1);
    for (const c of scene.projects ?? []) {
      const m = w.motion(c.crate)!;
      const on = Math.abs(m.pose.p[0] - TOP[0]) < half[0] && Math.abs(m.pose.p[2] - TOP[2]) < half[2] && m.pose.p[1] > TOP[1];
      if (on && m.mode === 'free' && !m.awake && w.setting(c.crate, OPEN) !== true) worst = Math.max(worst, ++run);
      else run = 0;
    }
  }
  return worst;
}

describe('a crate lifted off the stand and let go over it again', () => {
  const spots: [string, number, number][] = [];
  for (const [n, dx, dz] of [['left', -1, 0], ['right', 1, 0], ['back', 0, -1], ['front', 0, 1], ['left back', -1, -1], ['right back', 1, -1], ['left front', -1, 1], ['right front', 1, 1]] as const) spots.push([n, dx, dz]);
  // how it is let go: carried out over the edge high and let go still; a short quick drag let go low, still or moving
  const HOW = [
    { name: 'high, still', steps: 24, lift: 0.5, reach: 1, v: 0 },
    { name: 'low and quick, still', steps: 5, lift: 0.08, reach: 0.6, v: 0 },
    { name: 'low and quick, moving', steps: 5, lift: 0.08, reach: 0.6, v: 1.2 },
    { name: 'over the lip, moving', steps: 8, lift: 0.15, reach: 1.15, v: 0.8 },
  ] as const;
  for (const how of HOW) for (const turned of [false, true]) {
    test.each(spots)(`over the %s edge, ${how.name}${turned ? ', the dial turned first' : ''}: it opens on the deck (or is set beside), never lies shut on it`, async (_, dx, dz) => {
      const w = await benchWorld(`relift-${dx}-${dz}-${turned}-${how.steps}-${how.v}`, { scene });
      const t = tape(w);
      t.run(30);
      putOn(w, t, C, TOP);
      t.run(120);
      expect(w.setting(C, OPEN)).toBe(true);
      if (turned) {
        w.dispatch({ type: 'press', id: PAINT.knob });
        t.run(60);
      }
      // lifted a little and carried out over the edge (the hand's short drag), let go at once (the camera still moving)
      const p = w.motion(C)!.pose.p;
      w.dispatch({ type: 'grab', id: C, grip: p });
      const to: Vec3 = [TOP[0] + dx * (half[0] - 0.05) * how.reach, p[1] + how.lift, TOP[2] + dz * (half[2] - 0.05) * how.reach];
      for (let i = 0; i < how.steps; i++) {
        w.dispatch({ type: 'carry', target: [p[0] + ((to[0] - p[0]) * (i + 1)) / how.steps, to[1], p[2] + ((to[2] - p[2]) * (i + 1)) / how.steps] });
        t.run(1);
      }
      w.dispatch({ type: 'release', velocity: [dx * how.v, 0, dz * how.v] });
      const worst = watch(w, t, 300);
      expect(worst, 'steps a shut crate lay at rest on the deck').toBeLessThanOrEqual(60);
      w.dispose();
    }, 60_000);
  }
});

describe('a crate lifted off the stand and put back where it lay (the hand undid its own pick-up)', () => {
  for (const [name, end] of [
    ['let go at once, still (a pick-up cancelled)', 'cancel'],
    ["a double-tap's first tap took it up (select puts it back)", 'select'],
    ["carried off, and a double-click's select puts it back", 'carried-select'],
  ] as const) {
    test(name, async () => {
      const w = await benchWorld(`relift-${end}`, { scene });
      const t = tape(w);
      t.run(30);
      putOn(w, t, C, TOP);
      t.run(120);
      expect(w.setting(C, OPEN)).toBe(true);
      const p = w.motion(C)!.pose.p;
      w.dispatch({ type: 'grab', id: C, grip: p });
      if (end === 'cancel') {
        t.run(3);
        w.dispatch({ type: 'release', velocity: [0, 0, 0] });
      } else if (end === 'select') {
        t.run(3);
        w.dispatch({ type: 'select', id: C });
      } else {
        for (let i = 0; i < 20; i++) {
          w.dispatch({ type: 'carry', target: [p[0] - 1.2, 1.2, p[2] + 0.4] });
          t.run(1);
        }
        w.dispatch({ type: 'select', id: C });
      }
      const worst = watch(w, t, 300);
      const m = w.motion(C)!;
      process.stderr.write(`${end}: open ${String(w.setting(C, OPEN))} at ${m.pose.p.map((x) => x.toFixed(2)).join(', ')} worst ${worst}\n`);
      expect(worst, 'steps a shut crate lay at rest on the deck').toBeLessThanOrEqual(60);
      w.dispose();
    }, 60_000);
  }
});
