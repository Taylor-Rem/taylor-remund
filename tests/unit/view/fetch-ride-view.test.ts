// R2 (Taylor's coworkers): Fetch set on the belt rides it (sat up on its wheel, arms out, the eye wide), goes through
// the dock's door with a last look back, is thrown home by the chute (limbs out, the eye huge) and shakes itself off.
import { describe, expect, test } from 'vitest';
import { stubWorld } from '../sim/helpers.ts';
import { FetchPerformer, type FetchInput } from '../../../src/workshop/view/stations/fetch.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import type { CrewMember, FetchState } from '../../../src/workshop/sim/types.ts';

type Step = { state: FetchState; mode: FetchInput['mode']; ride: FetchInput['ride'] };

function run(steps: (t: number) => Step, seconds: number, reducedMotion = false) {
  const { world } = stubWorld();
  const perf = new FetchPerformer(7);
  const id = world.scene.runner.id;
  world.advance();
  const m0 = world.crew(id)! as CrewMember;
  const mo = world.motion(id)!;
  const out: Array<{ t: number; pose: ReturnType<FetchPerformer['update']>['pose'] }> = [];
  for (let k = 0; k < seconds * HZ; k++) {
    const t = k / HZ;
    const s = steps(t);
    const input: FetchInput = {
      time: t, dt: 1 / HZ, member: { ...m0, state: s.state, stateTime: t, speed: 0 }, mode: s.mode, pose: mo.pose, teleport: false,
      half: world.halfExtents(id)!, pointer: null, hovered: false, visitor: [0, 9, 14], button: null, carriedAt: null, nearHeld: null,
      sights: [], events: [], reducedMotion, ride: s.ride,
    };
    out.push({ t, pose: perf.update(input).pose });
  }
  return out;
}
const at = (s: ReturnType<typeof run>, t: number) => s.find((x) => Math.abs(x.t - t) < 0.5 / HZ)!.pose;

describe('Fetch view: riding the belt and coming home (R2)', () => {
  test('on the belt it is not the held dangle: sat down on its wheel, arms out for balance, the eye wide', () => {
    const riding = run(() => ({ state: 'held', mode: 'machine', ride: 'belt' }), 1.5);
    const inHand = run(() => ({ state: 'held', mode: 'held', ride: null }), 1.5);
    const r = at(riding, 1.2), h = at(inHand, 1.2);
    expect(r.squash!).toBeGreaterThan(0.3);
    expect(h.squash!).toBeLessThan(0);
    expect(r.eyeScale!).toBeGreaterThan(1.1);
    const arms = r.arms as { left: { abduct: number } };
    expect(arms.left.abduct).toBeGreaterThan(1);
  });

  test('thrown home: limbs out and the eye huge; landed, it shakes itself off (not in reduced motion)', () => {
    const plan = (t: number): Step => (t < 1 ? { state: 'held', mode: 'machine', ride: 'thrown' } : t < 1.3 ? { state: 'held', mode: 'free', ride: null } : { state: 'shrug', mode: 'crew', ride: null });
    const s = run(plan, 2.6);
    expect(at(s, 0.6).eyeScale).toBe(1.45);
    // the shake: the side lean swings both ways between 0.4 and 0.9 s after touching down
    const side = s.filter((x) => x.t > 1.4 && x.t < 1.9).map((x) => x.pose.lean![1]);
    expect(Math.max(...side) - Math.min(...side)).toBeGreaterThan(0.2);
    const still = run(plan, 2.6, true).filter((x) => x.t > 1.4 && x.t < 1.9).map((x) => x.pose.lean![1]);
    expect(Math.max(...still) - Math.min(...still)).toBeLessThan(Math.max(...side) - Math.min(...side));
  });
});
