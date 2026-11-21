// Fetch over the bench's edge keeps the motion it had (Taylor, 2026-11-20: "Eliminate unnatural discontinuities ...
// Fetch stopping at edges"; "Preserve reliability ... the characters reliably return home"). Physics carries it past
// the edge and down; out of sight under the edge its jetpack's script takes it as it was moving, brakes the fall, and
// flies it back to its tape. Checked step by step under real Rapier on the whole bench: off the left, right and front
// edges, low and high, slow and fast, tumbling off the edge's lip, let go still past the edge, with the crate it was
// carrying, and with a Button rung played while it is in the air.
import { describe, expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { startPlay } from './fetch-helpers.ts';
import { lanePath } from '../../src/workshop/sim/path.ts';
import { FETCH_TUNING } from '../../src/workshop/sim/crew/fetch.ts';
import { JET_TUNING } from '../../src/workshop/sim/crew/fetch-jet.ts';
import { HZ, steps } from '../../src/workshop/sim/clock.ts';
import { qconj, qmul, rotationVector } from '../../src/workshop/sim/math.ts';
import type { Quat, SimEvent, Vec3 } from '../../src/workshop/sim/types.ts';
import type { World } from '../../src/workshop/sim/world.ts';

const SCENE = FULL_BENCH;
const B = SCENE.bench;
const G = Math.abs(SCENE.gravity);
const PATH = lanePath(SCENE.runner.lane.points, FETCH_TUNING.cornerRadius * (SCENE.crewScale ?? 1));
const onTape = (x: number, z: number): number => {
  const q = PATH.at(PATH.nearest(x, z));
  return Math.hypot(q[0] - x, q[1] - z);
};

/**
 * THE BOUNDS (per 1/60 s step; velocities are finite differences of the body's centre, world units/s).
 *
 * HANDOVER: the step physics gives it to the script, its velocity changes by no more than gravity's own step (16/60 =
 * 0.27: the script integrates the same gravity half a step differently from Rapier) plus a margin for Rapier's
 * contact solver if it was still brushing the bench's face (0.25): 0.55. The old code stopped it dead here (9.8).
 */
const HANDOVER_DV = G / HZ + 0.28;
/**
 * HANDOVER, SPIN: its tumble carries on through the step (the script's ease to upright starts flat), running down at
 * the script's `spinDamp` (2.5/s: at the 6 rad/s of the hardest throws, 0.25 rad/s in a step) and turned by the ease's
 * first step; Rapier's own spin in the air changes by nothing. 0.6 rad/s. The old code stopped it dead (and the view
 * pinned the drawn body for a third of a second).
 */
const HANDOVER_DW = 0.6;
/**
 * IN THE AIR, SCRIPTED: the hardest push of the flight is a smooth ease's peak (6 x distance / time²: the rise and
 * the descent, which are the exaggerated jetpack moves) or the jets' braking (`catchAccel`) on top of gravity; none
 * exceeds 70 units/s² (about 4.4 g): 70/60 = 1.17 per step. The one step allowed more is the touchdown (the jets are
 * cut and it drops `cutAbove` onto its wheel: sqrt(2 g cutAbove) down to the bounce's start up, a real contact).
 */
const AIR_DV = 70 / HZ;
const TOUCHDOWN_DV = Math.sqrt(2 * G * JET_TUNING.cutAbove) + (Math.PI * JET_TUNING.bounceHeight) / JET_TUNING.bounce + 0.3;
/** NO HANG: in the air (its centre above standing height or below the bench top), never two steps running slower than this (a pause of a frame or more the eye reads as a stop; the old code held 6 steps at the bottom and 1 at the edge). */
const STILL = 0.05;

interface Run {
  ev: SimEvent[];
  /** Steps from the release to rolling on its tape again; to the script's taking it; the largest handover |dv|; the spin it was taken with. */
  back: number;
  takenAfter: number;
  handoverDv: number;
  handoverV: Vec3;
  spin: number;
  /** The change of its spin (rad/s) across the handover step. */
  handoverDw: number;
  worstAir: number;
  worstAirAt: string;
  hangs: string[];
  modes: Set<string>;
}

/**
 * The visitor lifts Fetch, carries it to `to` and lets go with `velocity` (from inside the bench, or past its edge);
 * then every step is checked until it is rolling on its tape again (or `within` seconds).
 */
function overboard(w: World, to: Vec3, velocity: Vec3, o: { within?: number; during?: (w: World, step: number) => void } = {}): Run {
  const ev: SimEvent[] = [];
  const step = (): void => {
    w.advance();
    ev.push(...w.drainEvents());
  };
  const p = w.motion('fetch')!.pose.p;
  w.dispatch({ type: 'grab', id: 'fetch', grip: p });
  step();
  const high: Vec3 = [p[0], Math.max(3.4, to[1]), p[2]];
  for (let i = 1; i <= 50; i++) {
    const f = i / 50;
    w.dispatch({ type: 'carry', target: f < 0.3 ? [p[0], p[1] + (high[1] - p[1]) * (f / 0.3), p[2]] : [high[0] + (to[0] - high[0]) * ((f - 0.3) / 0.7), high[1] + (to[1] - high[1]) * ((f - 0.3) / 0.7), high[2] + (to[2] - high[2]) * ((f - 0.3) / 0.7)] });
    step();
  }
  // (held there long enough for the hand to arrive from anywhere on the bench)
  for (let i = 0; i < 60; i++) {
    w.dispatch({ type: 'carry', target: to });
    step();
  }
  w.dispatch({ type: 'release', velocity });
  step();
  const r: Run = { ev, back: -1, takenAfter: -1, handoverDv: 0, handoverV: [0, 0, 0], spin: 0, handoverDw: 0, worstAir: 0, worstAirAt: '', hangs: [], modes: new Set() };
  const half = FETCH_TUNING.bodyHalfHeight * (SCENE.crewScale ?? 1);
  let prevP: Vec3 = w.motion('fetch')!.pose.p;
  let prevQ: Quat = w.motion('fetch')!.pose.q;
  let prevV: Vec3 | null = null;
  let prevW: Vec3 = [0, 0, 0];
  let prevMode = w.mode('fetch')!;
  let slow = 0;
  let wentOver = false;
  for (let i = 1; i < steps(o.within ?? 7) && r.back < 0; i++) {
    o.during?.(w, i);
    step();
    const m = w.motion('fetch')!;
    const f = w.crew('fetch')!;
    const mode = w.mode('fetch')!;
    r.modes.add(mode);
    const v: Vec3 = [(m.pose.p[0] - prevP[0]) * HZ, (m.pose.p[1] - prevP[1]) * HZ, (m.pose.p[2] - prevP[2]) * HZ];
    const turn = rotationVector(qmul(m.pose.q, qconj(prevQ)));
    const wv: Vec3 = [turn[0] * HZ, turn[1] * HZ, turn[2] * HZ];
    const p = m.pose.p;
    if (p[0] < B.minX || p[0] > B.maxX || p[2] < B.minZ || p[2] > B.maxZ) wentOver = true;
    if (prevV && !w.bracketed) {
      const dv = Math.hypot(v[0] - prevV[0], v[1] - prevV[1], v[2] - prevV[2]);
      if (prevMode === 'free' && mode === 'crew' && f.state === 'jetpack' && wentOver) {
        r.takenAfter = i;
        r.handoverDv = dv;
        r.handoverV = prevV;
        r.spin = Math.hypot(...prevW);
        r.handoverDw = Math.hypot(wv[0] - prevW[0], wv[1] - prevW[1], wv[2] - prevW[2]);
      } else if (prevMode === 'crew' && mode === 'crew' && f.state === 'jetpack') {
        const touchdown = f.jet?.phase === 'land';
        const bound = touchdown ? TOUCHDOWN_DV : AIR_DV;
        if (dv / bound > r.worstAir) {
          r.worstAir = dv / bound;
          r.worstAirAt = `step ${i} ${f.jet?.phase} dv ${dv.toFixed(2)} v (${v.map((c) => c.toFixed(2))}) <- (${prevV.map((c) => c.toFixed(2))})`;
        }
      }
      // no hang in the air: flying, or past the edge
      const airborne = (mode === 'crew' && f.state === 'jetpack' && Math.abs(p[1] - half) > 0.02) || (mode === 'free' && wentOver);
      if (airborne && Math.hypot(...v) < STILL) {
        slow++;
        if (slow >= 2) r.hangs.push(`step ${i} ${mode} ${f.state}/${f.jet?.phase} at (${p.map((c) => c.toFixed(2))})`);
      } else slow = 0;
    }
    if (wentOver && (f.state === 'idle' || f.state === 'roll') && mode === 'crew' && onTape(f.x, f.z) < 1e-6) r.back = i;
    prevP = p;
    prevQ = m.pose.q;
    prevV = w.bracketed ? null : v;
    prevW = wv;
    prevMode = mode;
  }
  return r;
}

function expectFlow(name: string, r: Run, o: { within?: number } = {}): void {
  console.log(
    `${name}: taken ${(r.takenAfter / HZ).toFixed(2)} s after the release, moving ${Math.hypot(...r.handoverV).toFixed(2)} (${r.handoverV.map((c) => c.toFixed(2))}) spinning ${r.spin.toFixed(1)} rad/s (change ${r.handoverDw.toFixed(2)}); ` +
      `handover |dv| ${r.handoverDv.toFixed(3)} (bound ${HANDOVER_DV.toFixed(2)}); worst air step ${(r.worstAir * 100).toFixed(0)}% of its bound (${r.worstAirAt}); back on its tape ${(r.back / HZ).toFixed(2)} s after the release`,
  );
  expect(r.takenAfter, 'the script took it from physics, past the edge').toBeGreaterThan(0);
  expect(r.handoverDv, 'the handover keeps its motion').toBeLessThanOrEqual(HANDOVER_DV);
  expect(r.handoverDw, 'and its spin').toBeLessThanOrEqual(HANDOVER_DW);
  expect(r.worstAir, `no jolt in the flight: ${r.worstAirAt}`).toBeLessThanOrEqual(1);
  expect(r.hangs, 'no hang in the air').toEqual([]);
  // always home: never through the chute, rolling on its tape again
  expect(r.modes.has('chute'), 'never sent by the chute').toBe(false);
  expect(r.ev.some((e) => e.type === 'part.returned' && e.id === 'fetch')).toBe(false);
  expect(r.ev.filter((e) => e.type === 'jet.ignited')).toHaveLength(1);
  expect(r.back, 'back on its tape').toBeGreaterThan(0);
  expect(r.back / HZ).toBeLessThanOrEqual(o.within ?? 6);
}

describe('Fetch over the edge keeps its motion, and always flies home', () => {
  const cases: [string, Vec3, Vec3][] = [
    ['left end, low and slow', [B.minX + 0.5, 1.0, -2], [-3.5, 0.5, 0]],
    ['left end, high and fast', [B.minX + 1.2, 3.4, -2], [-12, 2, 0]],
    ['left end, tumbling off the lip', [B.minX + 0.3, 1.0, -2], [-2.5, -3, 0]],
    ['right end, low and slow', [B.maxX - 0.5, 1.4, 1.5], [4, 1, 0]],
    ['right end, high and fast', [B.maxX - 1.2, 3.4, 1.5], [12, 3, 0]],
    ['front edge, low and slow', [7.3, 1.0, B.maxZ - 0.5], [0, 0, 2]],
    ['front edge, high and fast', [-1, 3.4, 3.6], [0, 3, 11]],
    ['front edge, tumbling off the lip', [7.3, 1.0, B.maxZ - 0.3], [0, -3, 2.5]],
    ['let go still past the left end', [B.minX - 0.6, 1.5, 1.0], [0, 0, 0]],
    ['let go still past the front edge', [7.3, 1.5, B.maxZ + 0.6], [0, 0, 0]],
    ['thrown up and out from past the corner', [B.maxX + 0.9, 3, B.maxZ + 0.9], [6, 3, 6]],
  ];
  test.each(cases)('%s', async (name, to, velocity) => {
    const w = await benchWorld(`edge-flow-${name}`, { scene: SCENE });
    startPlay(w);
    expectFlow(name, overboard(w, to, velocity));
    w.dispose();
  }, 60_000);

  test('with the crate it was carrying: the crate falls by itself (back by the chute), Fetch flies home as smoothly', async () => {
    const w = await benchWorld('edge-flow-crate', { scene: SCENE });
    const crate = w.crew('fetch')!.carrying;
    expect(crate).not.toBeNull();
    startPlay(w);
    expectFlow('with its crate', overboard(w, [B.minX + 0.6, 1.2, -1], [-4, 1, 0]));
    w.dispose();
  }, 60_000);

  test('a Button rung pressed while it falls past the edge: it waits under physics, the rung rewinds it, and then it goes on and flies home', async () => {
    const w = await benchWorld('edge-flow-rung', { scene: SCENE });
    startPlay(w);
    let pressed = -1;
    let bracketed = false;
    const r = overboard(w, [B.minX + 0.6, 2.4, -2], [-3, 1, 0], {
      within: 30,
      during: (ww, i) => {
        bracketed ||= ww.bracketed;
        if (pressed < 0 && ww.mode('fetch') === 'free' && ww.motion('fetch')!.pose.p[0] < B.minX) {
          ww.dispatch({ type: 'press', id: 'button' });
          pressed = i;
        }
      },
    });
    expect(pressed).toBeGreaterThan(0);
    expect(bracketed, 'the rung played while it was in the air').toBe(true);
    expectFlow('mid-rung', r, { within: 30 });
    w.dispose();
  }, 120_000);
});
