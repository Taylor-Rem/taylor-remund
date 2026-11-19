import { describe, expect, test } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { stubWorld } from '../sim/helpers.ts';
import { FetchPerformer, type FetchInput } from '../../../src/workshop/view/stations/fetch.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import type { Arms } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

/** The performer at rest in the stub world, fed a grip point (world) for a while, then none. */
function run(hands: (k: number, at: Vector3, heading: number) => Vec3 | null, n: number, half: Vec3 | null = [0.225, 0.22, 0.225]): Array<{ tele: number; weight: number; grip: Vector3; target: Vector3 | null }> {
  const { world } = stubWorld();
  const perf = new FetchPerformer(7);
  const id = world.scene.runner.id;
  const out: Array<{ tele: number; weight: number; grip: Vector3; target: Vector3 | null }> = [];
  for (let k = 0; k < n; k++) {
    world.advance();
    const m = world.crew(id)!;
    const mo = world.motion(id)!;
    const at = new Vector3(...mo.pose.p);
    const input: FetchInput = {
      time: world.step / HZ, dt: 1 / HZ, member: { ...m, state: 'idle', stateTime: 1 }, mode: mo.mode, pose: mo.pose, teleport: false,
      half: world.halfExtents(id)!, pointer: null, hovered: false, visitor: [0, 9, 14], button: null, carriedAt: null, nearHeld: null,
      sights: [], events: [], reducedMotion: false, hands: hands(k, at, m.heading), handsHalf: half, scale: 1,
    };
    const r = perf.update(input);
    const arms = r.pose.arms as Arms;
    const st = (arms.left.tele ?? [0, 0, 0]) as readonly number[] | number;
    const tele = typeof st === 'number' ? st : st[0]! + st[1]! + st[2]!;
    const grip = (r.reach?.grip ?? new Vector3()).clone().applyMatrix4(new Matrix4().copy(r.root));
    out.push({ tele, weight: r.reach?.weight ?? 0, grip, target: input.hands ? new Vector3(...input.hands) : null });
  }
  return out;
}

describe('Fetch view: the reach follows the grip point (telescoping forearms)', () => {
  test('a far point: the arms reach it on their tubes, then come home when it goes', () => {
    // 0.72 ahead of its centre, a little above it, wherever it is (it may be rolling its lane)
    const s = run((k, at, h) => (k < 120 ? [at.x + Math.sin(h) * 0.72, at.y + 0.12, at.z + Math.cos(h) * 0.72] : null), 220);
    const out = s[119]!;
    const target = out.target!;
    expect(out.weight).toBeGreaterThan(0.98);
    expect(out.tele).toBeGreaterThan(0.05);
    expect(out.grip.distanceTo(target)).toBeLessThan(0.06);
    expect(s[219]!.weight).toBeLessThan(0.05);
    expect(s[219]!.tele).toBeLessThan(1e-3);
  });

  test('without a point it does not reach at all (as before the reach existed)', () => {
    const s = run(() => null, 60);
    expect(Math.max(...s.map((x) => x.weight))).toBe(0);
  });
});
