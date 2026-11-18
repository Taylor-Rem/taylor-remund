// The dock's ramp as the simulation owns it (sim/ramp.ts, scenes/bench.ts LINE.ramp) is the shape the
// dock piece draws (view/kit/pieces/dock/dims.ts): placed at LINE.door.origin, the piece's own ramp,
// fitted from that door to the belt's end, has the same centre line.
import { describe, expect, test } from 'vitest';
import { LINE, AT } from '../../../src/workshop/sim/scenes/bench.ts';
import { rampAt, rampDoor, rampLength } from '../../../src/workshop/sim/ramp.ts';
import { DOCK, rampAt as pieceRampAt, rampGeom } from '../../../src/workshop/view/kit/pieces/dock/dims.ts';

describe('the dock ramp', () => {
  const R = LINE.ramp;
  const door = LINE.door.origin;
  const g = rampGeom(R.turn, [R.start[0] - door[0], R.start[2] - door[2]]);

  test("starts just past the belt's bed, at its height, and ends on the sill", () => {
    expect(R.start[0]).toBeCloseTo(AT.belt.c[0] + AT.belt.half[0] + DOCK.beltGap, 9);
    expect(R.start[1]).toBe(DOCK.rampTopIn);
    expect(rampAt(R, rampLength(R)).p[1]).toBeCloseTo(DOCK.sillY, 9);
    expect(rampDoor(R).origin).toEqual(door);
  });

  test("is the dock piece's ramp, point for point, with the piece at the door", () => {
    expect(g.length).toBeCloseTo(rampLength(R), 6);
    for (let i = 0; i <= 20; i++) {
      const s = (rampLength(R) * i) / 20;
      const a = rampAt(R, s);
      const b = pieceRampAt(g, s);
      expect(a.p[0], `x at ${s}`).toBeCloseTo(b.x + door[0], 6);
      expect(a.p[1], `y at ${s}`).toBeCloseTo(b.y, 6);
      expect(a.p[2], `z at ${s}`).toBeCloseTo(b.z + door[2], 6);
    }
  });

  test('the door stands near the dock spot of the layout', () => {
    expect(Math.hypot(door[0] - AT.dock.c[0], door[2] - AT.dock.c[2])).toBeLessThan(0.3);
  });
});
