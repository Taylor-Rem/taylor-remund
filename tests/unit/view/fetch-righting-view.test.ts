// R4 (Taylor: "throw boxes and Fetch ... They should still always be able to recover"): thrown, Fetch comes to rest
// on its side; when the simulation has it up again it does not pop upright in one frame: it lies there a beat,
// dazed, then pushes itself up with an arm over about half a second.
import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { stubWorld } from '../sim/helpers.ts';
import { FetchPerformer, type FetchInput } from '../../../src/workshop/view/stations/fetch.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import type { CrewMember } from '../../../src/workshop/sim/types.ts';

function run(reducedMotion: boolean) {
  const { world } = stubWorld();
  const perf = new FetchPerformer(7);
  const id = world.scene.runner.id;
  world.advance();
  const m0 = world.crew(id)! as CrewMember;
  const p = world.motion(id)!.pose.p;
  const half = world.halfExtents(id)!;
  // on its side (rolled 90 degrees about its forward axis), then up again at 0.5 s
  const side = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  const out: Array<{ t: number; up: number; lids: number }> = [];
  for (let k = 0; k < 2 * HZ; k++) {
    const t = k / HZ;
    const lying = t < 0.5;
    const input: FetchInput = {
      time: t, dt: 1 / HZ, member: { ...m0, state: lying ? 'held' : 'shrug', stateTime: lying ? t : t - 0.5, speed: 0, heading: 0 }, mode: lying ? 'free' : 'crew',
      pose: { p: [p[0], lying ? half[0] : p[1], p[2]], q: lying ? [side.x, side.y, side.z, side.w] : [0, 0, 0, 1] }, teleport: false,
      half, pointer: null, hovered: false, visitor: [0, 9, 14], button: null, carriedAt: null, nearHeld: null, sights: [], events: [], reducedMotion,
    };
    const r = perf.update(input);
    const q = new Quaternion().setFromRotationMatrix(r.root);
    out.push({ t, up: new Vector3(0, 1, 0).applyQuaternion(q).y, lids: r.pose.lids?.[0] ?? 0 });
  }
  return out;
}
const at = (s: ReturnType<typeof run>, t: number) => s.find((x) => Math.abs(x.t - t) < 0.5 / HZ)!;

describe('Fetch view: righting itself after a throw (R4)', () => {
  test('a dazed beat on its side, then up over about half a second: never in one frame', () => {
    const s = run(false);
    expect(at(s, 0.6).up, 'still down, dazed').toBeLessThan(0.3);
    expect(at(s, 0.6).lids, 'half lids').toBeGreaterThan(0.3);
    expect(at(s, 1.0).up, 'on its way up').toBeGreaterThan(0.2);
    expect(at(s, 1.0).up).toBeLessThan(0.98);
    expect(at(s, 1.6).up, 'up').toBeGreaterThan(0.99);
    // no step bigger than a tenth of a turn's worth of up between frames
    for (let k = 1; k < s.length; k++) expect(Math.abs(s[k]!.up - s[k - 1]!.up), `t=${s[k]!.t.toFixed(2)}`).toBeLessThan(0.15);
  });

  test('reduced motion: no dazed beat, and still no snap', () => {
    const s = run(true);
    expect(at(s, 1.1).up).toBeGreaterThan(0.99);
    for (let k = 1; k < s.length; k++) expect(Math.abs(s[k]!.up - s[k - 1]!.up)).toBeLessThan(0.25);
  });
});
