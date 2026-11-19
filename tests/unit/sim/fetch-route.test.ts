// S5 round 3: the way back to its path. The routing alone, then Fetch set down at four places round a fixed
// body that stands between it and its path (the vignette's console), on the stub physics: it reaches its path
// and its footprint never enters the body.
import { describe, expect, test } from 'vitest';
import { legClear, route, segmentToBody } from '../../../src/workshop/sim/crew/fetch-route.ts';
import type { Pt } from '../../../src/workshop/sim/crew/fetch-route.ts';
import { KNOCK_TUNING, distanceTo } from '../../../src/workshop/sim/crew/fetch-knock.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';
import { lanePath } from '../../../src/workshop/sim/path.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import { defaultHalfExtents } from '../../../src/workshop/sim/parts.ts';
import { steps } from '../../../src/workshop/sim/clock.ts';
import { stubWorld, run } from './helpers.ts';

const BOX = { id: 'box', x: 0, z: 0, hx: 1, hz: 0.5, yaw: 0 };
const BENCH = { minX: -9, maxX: 9, minZ: -9, maxZ: 9 };

describe('the way back (routing alone)', () => {
  test('a segment and a box: apart, touching, crossing', () => {
    expect(segmentToBody(BOX, [-3, 2], [3, 2])).toBeCloseTo(1.5, 9);
    expect(segmentToBody(BOX, [-3, 0], [3, 0])).toBe(0);
    expect(segmentToBody(BOX, [2, -3], [2, 3])).toBeCloseTo(1, 9);
  });

  test('a clear line is taken straight', () => {
    expect(route([-3, 2], [3, 2], 0.5, [BOX], BENCH)).toEqual([[3, 2]]);
  });

  test('a body in the way: round it by its nearer side, the footprint clear all along', () => {
    const r = 0.5;
    const from: Pt = [0.3, -2];
    const to: Pt = [0.3, 2];
    expect(legClear(from, to, r, [BOX])).toBe(false);
    const way = route(from, to, r, [BOX], BENCH)!;
    expect(way.at(-1)).toEqual(to);
    expect(way.length).toBeGreaterThanOrEqual(2);
    // by the nearer side (+X: it starts right of the middle)
    expect(way[0]![0]).toBeGreaterThan(0);
    let a = from;
    for (const p of way) {
      expect(segmentToBody(BOX, a, p)).toBeGreaterThanOrEqual(r - 1e-9);
      a = p;
    }
  });

  test('shut in: no way out is null', () => {
    const walls = [
      { id: 'n', x: 0, z: -2, hx: 3, hz: 0.5, yaw: 0 },
      { id: 's', x: 0, z: 2, hx: 3, hz: 0.5, yaw: 0 },
      { id: 'w', x: -2, z: 0, hx: 0.5, hz: 3, yaw: 0 },
      { id: 'e', x: 2, z: 0, hx: 0.5, hz: 3, yaw: 0 },
    ];
    expect(route([0, 0], [5, 5], 0.4, walls, BENCH)).toBeNull();
  });
});

describe('set down behind a fixed body, it goes round it to its path', () => {
  const console_ = vignette.statics.find((s) => s.id === 'console')!;
  const half = console_.shape.type === 'box' ? console_.shape.half : [0, 0, 0];
  const body = { id: 'console', x: console_.pose.p[0], z: console_.pose.p[2], hx: half[0]!, hz: half[2]!, yaw: 0 };
  const fh = defaultHalfExtents('robot', 'M');
  const r = Math.hypot(fh[0], fh[2]) + KNOCK_TUNING.margin;
  const path = lanePath(vignette.runner.lane.points, FETCH_TUNING.cornerRadius);
  // four places round it: behind its middle, behind each end, and beside it
  const places: Pt[] = [
    [body.x, body.z - body.hz - r - 0.05],
    [body.x - body.hx + 0.2, body.z - body.hz - r - 0.05],
    [body.x + body.hx - 0.2, body.z - body.hz - r - 0.05],
    [body.x + body.hx + r + 0.1, body.z],
  ];
  test.each(places.map((p, i) => [i, p] as const))('place %i: it reaches its path, its footprint never in the box', (_i, at) => {
    const { world: w } = stubWorld(1);
    run(w, 10);
    w.dispatch({ type: 'grab', id: 'fetch', grip: w.motion('fetch')!.pose.p });
    run(w, 1);
    for (let i = 0; i < 40; i++) {
      w.dispatch({ type: 'carry', target: [at[0], 1.2, at[1]] });
      run(w, 1);
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    let back = false;
    let started: number | null = null;
    for (let i = 0; i < steps(15) && !back; i++) {
      if (i % steps(2) === 0) w.dispatch({ type: 'hover', id: null });
      run(w, 1);
      const f = w.crew('fetch')!;
      if (f.state === 'return') {
        started ??= distanceTo(body, f.x, f.z);
        expect(distanceTo(body, f.x, f.z), `at ${f.x.toFixed(2)}, ${f.z.toFixed(2)}`).toBeGreaterThanOrEqual(Math.min(r, started) - 1e-6);
      }
      if (f.state === 'idle' && started !== null) {
        const q = path.at(path.nearest(f.x, f.z));
        back = Math.hypot(q[0] - f.x, q[1] - f.z) < 1e-6;
      }
    }
    expect(started).not.toBeNull();
    expect(back).toBe(true);
  });
});
