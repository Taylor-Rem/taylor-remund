// S6, seam 7: the simulation's lamp aims where the lamp piece can aim. The scene's polygon is the piece's
// `REACH` (view/kit/pieces/lamp/aim.ts), placed at the lamp's clamp, the way ramp.test.ts holds the dock's
// ramp against the piece's. And the box of space the bulb can then occupy, for the shadow casters' KEY_REGION.
import { describe, expect, it } from 'vitest';
import { REACH, aimLamp, reachInWorld } from '../../../src/workshop/view/kit/pieces/lamp/aim.ts';
import { KEY_REGION } from '../../../src/workshop/view/kit/realize.ts';
import { PATCHLAMP } from '../../../src/workshop/sim/scenes/bench.ts';
import { insidePolygon, reachable } from '../../../src/workshop/sim/machines/lamp.ts';
import type { LampSpec } from '../../../src/workshop/sim/machines/lamp.ts';

const L = PATCHLAMP.lamp;
const SPEC: LampSpec = { id: 'lamp', station: 'top', name: 'name.lamp', levels: 5, startLevel: 3, home: L.home, reach: L.reach };

describe("the lamp's reach is the piece's", () => {
  it("the scene's region is the piece's REACH, in the lamp's own space and placed at its clamp in the world", () => {
    expect(L.region.map((p) => [...p])).toEqual(REACH.map((p) => [...p]));
    expect(L.reach.polygon.map((p) => [...p])).toEqual(reachInWorld(L.clamp));
  });

  it('the home aim is inside it, at lamp-space (5.1, 4.9)', () => {
    expect(insidePolygon(L.reach.polygon, L.home.aim[0], L.home.aim[2])).toBe(true);
    expect(L.home.aim[0] - L.clamp[0]).toBeCloseTo(5.1, 9);
    expect(L.home.aim[2] - L.clamp[2]).toBeCloseTo(4.9, 9);
  });

  it('every aim the simulation keeps, the piece lands its beam on', () => {
    for (let i = 0; i < 24; i++)
      for (let k = 0; k < 16; k++) {
        const [x, z] = reachable(SPEC, -12 + i, -6 + k * 0.8);
        const a = aimLamp([x - L.clamp[0], 0, z - L.clamp[2]]);
        expect(Math.hypot(a.lands[0] - (x - L.clamp[0]), a.lands[2] - (z - L.clamp[2])), `${x}, ${z}`).toBeLessThan(0.02);
      }
  });

  it('the bulb, over the whole region, stays in one box of space (reported for the shadow casters)', () => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const poly = L.region;
    const xs = poly.map((p) => p[0]);
    const zs = poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.25)
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.25) {
        if (!insidePolygon(poly, x, z)) continue;
        const b = aimLamp([x, 0, z]).bulb;
        const w = [b[0] + L.clamp[0], b[1] + L.clamp[1], b[2] + L.clamp[2]];
        for (let i = 0; i < 3; i++) {
          lo[i] = Math.min(lo[i]!, w[i]!);
          hi[i] = Math.max(hi[i]!, w[i]!);
        }
      }
    process.stdout.write(`\nlamp bulb box (world): min ${lo.map((v) => v.toFixed(2)).join(', ')}  max ${hi.map((v) => v.toFixed(2)).join(', ')}; KEY_REGION min ${KEY_REGION.min.join(', ')} max ${KEY_REGION.max.join(', ')}\n`);
    expect(Number.isFinite(lo[0]!)).toBe(true);
  });
});
