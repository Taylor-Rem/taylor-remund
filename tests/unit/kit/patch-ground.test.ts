// R4 (Taylor: "I've noticed Patch often clips through the floor"): no drawn part of Patch below the bench's top in
// any state the bench sees it in. Each state's pose sampled at twenty times, as the operator view draws it (grounded:
// lifted by what the posed figure needs), and the posed figure's lowest point over the bench is at or above it.
import { describe, expect, it } from 'vitest';
import { patchFelt } from '../../../src/workshop/view/kit/pieces/patch-felt/index.ts';
import { clearOfEdge, figureOf, grounded, lowestY } from '../../../src/workshop/view/kit/pieces/patch-felt/ground.ts';
import * as PF from '../../../src/workshop/view/kit/pieces/patch-felt/perform.ts';
import type { PatchPose } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';

type V3 = [number, number, number];
const fig = figureOf(patchFelt({ seed: 1, standIn: false } as never));
/** The floor in root space (the perform functions take the simulation's points in root space: on the floor, y 0). */
const FLOOR = 0;
const N = 20;
const times = (L: number): number[] => Array.from({ length: N }, (_, i) => (L * i) / (N - 1));

/** Each state: a pose at time t, and (over the edge) which root-space points are over the bench. */
const states: { name: string; L: number; pose: (t: number) => PatchPose; inside?: (x: number, z: number) => boolean; fix?: (p: PatchPose, inside?: (x: number, z: number) => boolean) => PatchPose }[] = [];
states.push({ name: 'the sit and the shake', L: PF.SHAKE_LENGTH, pose: (t) => PF.shakeOff(t, [0, FLOOR, 0], -0.4) });
// the wall slide: its middle down the wall from a unit up to where it lands (0.3 above the bench)
states.push({ name: 'the wall slide', L: 1.4, pose: (t) => PF.splat(t, [0, FLOOR + Math.max(0.3, 1.0 - Math.max(0, t - 0.35) * 0.7), 0], 1.2, 0.35) });
states.push({ name: 'the walk', L: 1.6, pose: (t) => PF.toddle(t * 0.9, [0, FLOOR, 0], 0.8) });
states.push({ name: 'the scamper', L: 1.6, pose: (t) => PF.toddle(t * 1.4, [0, FLOOR, 0], -1.1, { scamper: true }) });
// R4 up: falling onto the bench (its middle down to 0.3 above it), the top of a throw up just above it, and the
// "really?" with the dusting off (the get-up and the flop from how its body lay: tests/unit/kit/patch-embodied.test.ts)
states.push({ name: 'falling onto the bench', L: 0.8, pose: (t) => PF.falling(t, [0, FLOOR + 0.3 + (0.8 - t) * 1.5, 0], 0.4) });
states.push({ name: 'the top of a throw up', L: 0.3, pose: (t) => PF.upward(t, [0, FLOOR + 0.6, 0], -0.6, t > 0.1) });
states.push({ name: '"really?" with the dusting off', L: 1.0, pose: (t) => PF.shakeOff(t, [0, FLOOR, 0], -0.4, { fall: 5, dust: true, length: 1.0 }) });
// the haul over the edge (edge at the origin, facing in along +z): only what is over the bench counts
const edge = { at: [0, FLOOR, 0] as V3, up: [0, FLOOR, 0.35] as V3, heading: 0, front: false };
// hanging from the edge: moved out from the bench's front (not lifted off the edge it holds)
states.push({ name: 'the hang from the edge', L: PF.LEDGE_LENGTH, pose: (t) => PF.overTheEdge('ledge', t, edge), inside: (_x, z) => z > 0, fix: (p, inside) => clearOfEdge(p, fig, FLOOR, inside!, [0, -1]) });
states.push({ name: 'the haul', L: PF.HAUL_LENGTH, pose: (t) => PF.overTheEdge('haul', t, edge), inside: (_x, z) => z > 0.02 });
states.push({ name: 'the dusting off', L: PF.DUST_LENGTH, pose: (t) => PF.overTheEdge('dust', t, edge), inside: (_x, z) => z > 0.02 });

describe('Patch never below the floor (R4)', () => {
  for (const s of states) {
    it(`${s.name}: the lowest drawn point is on or above the bench at each of twenty times`, () => {
      const raw: string[] = [];
      for (const t of times(s.L)) {
        const p = s.pose(t);
        const before = lowestY(p, fig, s.inside);
        const after = lowestY(s.fix ? s.fix(p, s.inside) : grounded(p, fig, FLOOR, s.inside), fig, s.inside);
        raw.push(`${t.toFixed(2)}:${before.toFixed(3)}`);
        expect(after, `${s.name} at ${t.toFixed(2)} s (ungrounded ${before.toFixed(3)})`).toBeGreaterThanOrEqual(FLOOR - 0.01);
      }
      if (process.env.PATCH_GROUND_LOG) console.log(`${s.name} ungrounded lowest: ${raw.join(' ')}`);
    });
  }
  it('the sit on the bench is posed on it (its legs and tail along the bench, not lifted off it)', () => {
    expect(lowestY(PF.shakeOff(0.3, [0, FLOOR, 0], 0.5), fig)).toBeGreaterThanOrEqual(FLOOR - 0.01);
  });
  it('grounding never lowers a pose that is clear of the floor', () => {
    const p = PF.shakeOff(0.3, [0, FLOOR + 0.5, 0], 0);
    expect(grounded(p, fig, FLOOR)).toBe(p);
  });
});
