// The belt's motor-end deflector as the simulation owns it (scenes/bench.ts LINE.belt.offBack, deflectAt,
// the belt mouth's drop point) is the one the belt piece draws (view/kit/pieces/belt: DEFLECT, the
// `off.back` socket, `deflectorAt`), with the piece's left end at the belt's `from`.
import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { LINE, bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { DEFLECT, deflectorAt } from '../../../src/workshop/view/kit/pieces/belt/index.ts';

describe('the motor-end deflector', () => {
  const B = LINE.belt;
  const L = B.to - B.from;

  test("a part sent off the back is set down at the piece's off.back socket", () => {
    // the piece is built about its middle: its off.back socket is at x -L/2 + rest.x, z rest.z in belt space
    const socket = new Vector3(-L / 2 + DEFLECT.rest[0], 0, DEFLECT.rest[1]);
    expect(B.offBack[0]).toBeCloseTo((B.from + B.to) / 2 + socket.x, 9);
    expect(B.offBack[1]).toBe(0);
    expect(B.offBack[2]).toBeCloseTo(B.z + socket.z, 9);
  });

  test("a part meets the deflector where its face crosses the belt's centre line", () => {
    // where the piece's curve crosses z = 0 (the belt's centre line), in world x
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (deflectorAt(0, mid)[1] > 0) lo = mid;
      else hi = mid;
    }
    const crossing = B.from + deflectorAt(0, lo)[0];
    expect(Math.abs(B.deflectAt - crossing)).toBeLessThan(0.05);
  });

  test('nothing is dropped onto the belt within the deflector: the drop point is past its gap', () => {
    const drop = bench.mouths!.find((m) => m.id === 'belt')!.drop;
    expect(drop[0] - B.from).toBeGreaterThanOrEqual(DEFLECT.gap + 0.1 - 1e-9);
  });
});
