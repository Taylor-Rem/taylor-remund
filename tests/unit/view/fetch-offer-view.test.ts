import { describe, expect, test } from 'vitest';
import { stubWorld } from '../sim/helpers.ts';
import { FetchPerformer, type FetchInput } from '../../../src/workshop/view/stations/fetch.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/index.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

/** The performer offering (state forced), the dropped crate 1 ahead, with the pointer where `pointer(t)` says. */
function offer(pointer: (t: number) => Vec3 | null, seconds: number): Array<{ t: number; squash: number; lean: number; headYaw: number }> {
  const { world } = stubWorld();
  const perf = new FetchPerformer(7);
  const id = world.scene.runner.id;
  world.advance();
  const m0 = world.crew(id)!;
  const mo = world.motion(id)!;
  const crate: Vec3 = [mo.pose.p[0] + Math.sin(m0.heading), 0.22, mo.pose.p[2] + Math.cos(m0.heading)];
  const out: Array<{ t: number; squash: number; lean: number; headYaw: number }> = [];
  for (let k = 0; k < seconds * HZ; k++) {
    const t = k / HZ;
    const input: FetchInput = {
      time: t, dt: 1 / HZ, member: { ...m0, state: 'offer', stateTime: t, lookAt: crate, speed: 0 }, mode: 'crew', pose: mo.pose, teleport: false,
      half: world.halfExtents(id)!, pointer: pointer(t), hovered: false, visitor: [0, 9, 14], button: null, carriedAt: null, nearHeld: null,
      sights: [], events: [], reducedMotion: false, feed: [crate[0] + 1, 0.3, crate[2]],
    };
    const r = perf.update(input);
    out.push({ t, squash: r.pose.squash ?? 0, lean: r.pose.lean?.[1] ?? 0, headYaw: r.pose.headYaw ?? 0 });
  }
  return out;
}

describe('Fetch view: the offer (R1)', () => {
  test('is never a statue after the embarrassed look: it shifts on its wheel and glances away, inside ignoredFor', () => {
    const s = offer(() => null, FETCH_TUNING.ignoredFor);
    // after the look settles (offerLook + 1.3 s), something moves in every 0.6 s window until the offer ends
    for (let a = FETCH_TUNING.offerLook + 1.3; a + 0.6 <= FETCH_TUNING.ignoredFor; a += 0.6) {
      const w = s.filter((x) => x.t >= a && x.t < a + 0.6);
      const range = (f: (x: (typeof w)[number]) => number): number => Math.max(...w.map(f)) - Math.min(...w.map(f));
      expect(range((x) => x.lean) + range((x) => x.squash) + range((x) => x.headYaw), `window at ${a.toFixed(1)} s`).toBeGreaterThan(0.01);
    }
  });

  test('perks up when the pointer comes to the crate, and sags when it leaves', () => {
    // the crate's place: 1 ahead of where it stands (as `offer` puts it); the pointer comes beside it at 2 s, leaves at 3.5 s
    const { world } = stubWorld();
    world.advance();
    const m = world.crew(world.scene.runner.id)!;
    const p = world.motion(world.scene.runner.id)!.pose.p;
    const beside: Vec3 = [p[0] + Math.sin(m.heading) + 0.2, 0, p[2] + Math.cos(m.heading)];
    const away = offer(() => null, 4.2);
    const near = offer((t) => (t > 2 && t < 3.5 ? beside : null), 4.2);
    const at = (s: typeof away, t: number): number => s.find((x) => Math.abs(x.t - t) < 0.5 / HZ)!.squash;
    expect(at(near, 3.2)).toBeLessThan(at(away, 3.2) - 0.1); // up on its spring, hopeful
    expect(at(near, 3.9)).toBeGreaterThan(at(away, 3.9)); // and a little sag once it has gone
  });
});
