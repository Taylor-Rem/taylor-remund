// S5 round 3: a stand at a path's very end is taken exactly. The platen's tray is handled from the end of the
// last run, the platen's body 0.4 beyond it: over three attract laps Fetch's centre never passes either end of
// its path, and its footprint never enters the platen. (A1 round 7: on the bench as laid out, its last run ending
// AT the platen's left stand, side-on to the plinth: the plinth and every other body of the platen.)
import { expect, test } from 'vitest';
import { benchWorld } from './line-helpers.ts';
import { bench } from '../../src/workshop/sim/scenes/bench.ts';
import { canRunLap, fetchStand } from '../../src/workshop/sim/crew/fetch.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import type { SceneDesc } from '../../src/workshop/sim/scene.ts';

const PLATEN = bench.statics.filter((s) => s.id.startsWith('platen'));
const POINTS = bench.runner.lane.points as readonly (readonly [number, number])[];
const END = POINTS[POINTS.length - 1]!;
const SCENE: SceneDesc = bench;

/** The overlap of two turned rectangles on the bench (positive: they overlap by that much). */
function overlap(ax: number, az: number, ayaw: number, ahx: number, ahz: number, bx: number, bz: number, byaw: number, bhx: number, bhz: number): number {
  const axes: [number, number][] = [
    [Math.cos(ayaw), -Math.sin(ayaw)],
    [Math.sin(ayaw), Math.cos(ayaw)],
    [Math.cos(byaw), -Math.sin(byaw)],
    [Math.sin(byaw), Math.cos(byaw)],
  ];
  const proj = (u: [number, number], yaw: number, hx: number, hz: number): number => hx * Math.abs(u[0] * Math.cos(yaw) - u[1] * Math.sin(yaw)) + hz * Math.abs(u[0] * Math.sin(yaw) + u[1] * Math.cos(yaw));
  let o = Infinity;
  for (const u of axes) o = Math.min(o, proj(u, ayaw, ahx, ahz) + proj(u, byaw, bhx, bhz) - Math.abs((bx - ax) * u[0] + (bz - az) * u[1]));
  return o;
}

test('a stand at the end of the last run: three laps, never past an end, never into the platen', async () => {
  expect(canRunLap(SCENE)).toEqual({ ok: true });
  const tray = SCENE.mouths!.find((m) => m.id === SCENE.runner.attract!.tray)!;
  const st = fetchStand(SCENE, 'tray', tray.drop[0], tray.drop[2]);
  expect(st.at[0]).toBeCloseTo(END[0], 9);
  expect(st.at[1]).toBeCloseTo(END[1], 9);
  const w = await benchWorld('end-stand', { scene: SCENE });
  const half = w.halfExtents('fetch')!;
  let atEnd = 0;
  let worst = -Infinity;
  for (let i = 0; i < 200 * HZ && w.attract().laps.length < 3; i++) {
    if (i % steps(2) === 0) w.dispatch({ type: 'hover', id: null }); // no fumble
    w.advance();
    w.drainEvents();
    const f = w.crew('fetch')!;
    if (f.state === 'held' || f.state === 'knocked' || f.state === 'return') continue;
    // never past either end of the path
    expect(POINTS[0]![0] - f.x, `step ${w.step} ${f.state}: past the first end`).toBeLessThanOrEqual(1e-6);
    expect(f.x - END[0], `step ${w.step} ${f.state}: past the last end (${f.x.toFixed(4)})`).toBeLessThanOrEqual(1e-6);
    if (Math.hypot(f.x - END[0], f.z - END[1]) < 1e-6) atEnd++;
    // its footprint never in the platen
    for (const p of PLATEN) {
      const ph = p.shape.type === 'box' ? p.shape.half : [0, 0, 0];
      const o = overlap(f.x, f.z, f.heading, half[0], half[2], p.pose.p[0], p.pose.p[2], 0, ph[0]!, ph[2]!);
      worst = Math.max(worst, o);
      expect(o, `step ${w.step} ${f.state}: into ${p.id} by ${o.toFixed(4)}`).toBeLessThanOrEqual(1e-6);
    }
  }
  console.log(`end stand: ${w.attract().laps.length} laps, ${(atEnd / HZ).toFixed(1)} s at the very end, closest to the platen ${(-worst).toFixed(3)}`);
  expect(w.attract().laps.length).toBe(3);
  expect(atEnd).toBeGreaterThan(steps(3)); // it worked there: set down, collected, three times
  w.dispose();
}, 180_000);
