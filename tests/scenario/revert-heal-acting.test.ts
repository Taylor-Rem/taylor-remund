// R3 finish: what Revert's view needs to act the heal. Out to heal a dry bench it stands a moment taking in the
// scene (`surveying`, with the crate it is out for in `bound`) before it sets off; the crate it carries rides on
// its pan's floor at its right side (where the view opens the pan out round it); a crate the visitor takes out of
// the pan is theirs, and Revert's view is told (`emptyPan`) so it can look at the empty pan and at the visitor.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, FULL_BENCH } from './line-helpers.ts';
import { steps, HZ } from '../../src/workshop/sim/clock.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import type { RevertView, Vec3 } from '../../src/workshop/sim/types.ts';
import { REVERT_TUNING } from '../../src/workshop/sim/crew/revert.ts';
import { REVERT_HEAL } from '../../src/workshop/sim/scenes/bench.ts';

const CRATES = ['crate-1', 'crate-2', 'crate-3', 'crate-4', 'crate-spare-1', 'crate-spare-2', 'crate-spare-3'];
const rv = (w: World): RevertView => w.machine('revert-crew') as RevertView;

/** The whole bench, the visitor strewing every crate into the back-left corner until Fetch has none it may carry. */
async function dryBench(seed: string): Promise<World> {
  const w = await benchWorld(seed, { scene: FULL_BENCH });
  const t = tape(w);
  t.run(steps(20));
  let n = 0;
  for (let k = 0; k < 16; k++) {
    const fresh = CRATES.filter((id) => w.mode(id) === 'free' && w.part(id)!.location.at === 'rest' && !w.touched(id));
    const busy = CRATES.some((id) => ['machine', 'chute', 'crew'].includes(w.mode(id) ?? ''));
    if (!fresh.length && !busy && k > 2) break;
    for (const id of fresh) {
      const i = n++;
      putOn(w, t, id, [-8.2 + 0.75 * (i % 2), 0, -4.2 + 0.75 * Math.floor(i / 2)]);
      t.run(steps(0.5));
    }
    t.run(steps(4));
  }
  return w;
}

describe('R3: Revert acts the heal', () => {
  test('it takes in the scene before it sets off, then carries the crate on its pan at its right side and drops it at home', async () => {
    // (2026-11-20: one crate thrown to the back left is enough to bring it out)
    const w = await benchWorld('acting-1', { scene: FULL_BENCH });
    tape(w).run(steps(20));
    putOn(w, tape(w), CRATES.find((x) => w.mode(x) === 'free' && w.part(x)!.location.at === 'rest')!, [-8.2, 0, -4.2]);
    const t = tape(w);
    let surveyed = 0;
    let boundWhileSurveying: string | null = null;
    let setOffAfterSurvey = false;
    const carried: { lateral: number; along: number; lift: number }[] = [];
    let dropped = false;
    for (let i = 0; i < steps(150) && !dropped; i++) {
      for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.to.at === 'shipped') dropped = true;
      const r = rv(w);
      if (r.surveying) {
        surveyed++;
        expect(r.state).toBe('idle');
        expect(r.speed).toBe(0);
        boundWhileSurveying = r.bound;
      } else if (surveyed > 0 && r.state === 'trundle' && !setOffAfterSurvey) {
        setOffAfterSurvey = true;
        expect(r.bound).toBe(boundWhileSurveying);
      }
      if (r.carrying) {
        const p = w.motion(r.carrying)!.pose.p;
        const h = w.halfExtents(r.carrying)!;
        const dx = p[0] - r.x, dz = p[2] - r.z;
        // its right (+x local): (cos h, -sin h); ahead: (sin h, cos h)
        carried.push({ lateral: dx * Math.cos(r.heading) - dz * Math.sin(r.heading) - h[0], along: dx * Math.sin(r.heading) + dz * Math.cos(r.heading), lift: p[1] - h[1] - w.scene.bench.top });
      }
    }
    // a look round of about REVERT_TUNING.survey seconds, at a crate it then went for
    // (2026-11-20: the whole look round when the bench has run dry, else one short look at the crate and the visitor)
    expect(surveyed / HZ).toBeGreaterThan(REVERT_TUNING.glance - 0.1);
    expect(surveyed / HZ).toBeLessThan(REVERT_TUNING.survey + 0.5);
    expect(boundWhileSurveying).not.toBeNull();
    expect(setOffAfterSurvey).toBe(true);
    // in the pan: its inner face just off Revert's right flank, centred fore and aft, on the pan's floor
    expect(carried.length).toBeGreaterThan(steps(1));
    for (const c of carried) {
      expect(c.lateral).toBeCloseTo(REVERT_TUNING.pan, 2);
      expect(Math.abs(c.along)).toBeLessThan(0.08); // (driven to where Revert stood a step before)
      expect(c.lift).toBeCloseTo(REVERT_TUNING.panHeight, 2);
    }
    expect(dropped).toBe(true);
    w.dispose();
  }, 300_000);

  test('the visitor takes the crate out of the pan: it is theirs, emptyPan counts up from that moment, and Revert leaves it be', async () => {
    const w = await dryBench('acting-2');
    const t = tape(w);
    for (let i = 0; i < steps(150) && !rv(w).carrying; i++) t.run(1);
    const id = rv(w).carrying!;
    expect(id).toBeTruthy();
    expect(rv(w).emptyPan).toBe(Infinity);
    t.run(steps(1));
    const p = w.motion(id)!.pose.p;
    w.dispatch({ type: 'grab', id, grip: [p[0], p[1], p[2]] });
    t.run(1);
    expect(rv(w).carrying).toBeNull();
    expect(rv(w).emptyPan).toBeLessThan(0.1);
    t.run(steps(1));
    expect(rv(w).emptyPan).toBeGreaterThan(0.9);
    expect(rv(w).emptyPan).toBeLessThan(1.2);
    const to: Vec3 = [-6, 0.6, 2];
    for (let i = 1; i <= 20; i++) {
      w.dispatch({ type: 'carry', target: [p[0] + ((to[0] - p[0]) * i) / 20, 1.5, p[2] + ((to[2] - p[2]) * i) / 20] });
      t.run(1);
    }
    // (and set down there: the hand stops over the spot before it lets go. The old carry lagged the hand so far that
    // this crate came to rest at (-6.31, -0.22), beside Revert's hatch with no stand to sweep it from, and was never
    // swept at all; now it lies where the visitor put it)
    for (let i = 0; i < 30; i++) {
      w.dispatch({ type: 'carry', target: [to[0], 1.5, to[2]] });
      t.run(1);
    }
    w.dispatch({ type: 'release', velocity: [0, 0, 0] });
    // theirs: it is not swept up again while it lies freshly stirred (Revert may go on to the other strays). Freshly
    // stirred is the bench's `REVERT_HEAL.stir`: after that a crate nobody stirs is a stray like any other, so the
    // window is that, not the 25 s the old test waited
    const STIR = REVERT_HEAL.stir;
    let again = false;
    for (let i = 0; i < steps(STIR); i++) for (const e of t.run(1)) if (e.type === 'revert.sweep' && e.part === id) again = true;
    expect(again).toBe(false);
    expect(w.part(id)!.location.at).toBe('rest');
    expect(w.mode(id)).toBe('free');
    w.dispose();
  }, 300_000);
});
