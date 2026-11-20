// A fresh view (page load, the stage rebuilt on a running world) draws Fetch exactly where the simulation has it from
// its first frame: no righting, no crouch, no ease from a pose it never drew. (The R4 righting eased a "teleport" from
// the view's never-drawn last position, the world's origin, so the loading picture showed Fetch on the Button.)
import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { stubWorld } from '../sim/helpers.ts';
import { FetchPerformer, type FetchInput } from '../../../src/workshop/view/stations/fetch.ts';
import { HZ } from '../../../src/workshop/sim/clock.ts';
import type { CrewMember, FetchState } from '../../../src/workshop/sim/types.ts';

function check(state: FetchState, speed: number, heading: number) {
  const { world } = stubWorld();
  const perf = new FetchPerformer(7);
  const id = world.scene.runner.id;
  world.advance();
  const m0 = world.crew(id)! as CrewMember;
  const p0 = world.motion(id)!.pose.p;
  const half = world.halfExtents(id)!;
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), heading);
  for (let k = 0; k <= 14; k++) {
    const t = k / HZ;
    const p: [number, number, number] = [p0[0] + Math.sin(heading) * speed * t, p0[1], p0[2] + Math.cos(heading) * speed * t];
    const input: FetchInput = {
      time: t, dt: 1 / HZ, member: { ...m0, state, stateTime: t, speed, heading }, mode: 'crew',
      // the first frame of a view is a teleport (the body's previous pose is its pose)
      pose: { p, q: [q.x, q.y, q.z, q.w] }, teleport: k === 0,
      half, pointer: null, hovered: false, visitor: [0, 9, 14], button: null, carriedAt: null, nearHeld: null, sights: [], events: [], reducedMotion: false,
    };
    const r = perf.update(input);
    if ([0, 1, 12, 14].includes(k)) {
      const at = new Vector3().setFromMatrixPosition(r.root);
      expect(Math.hypot(at.x - p[0], at.z - p[2]), `${state} frame ${k}: x, z`).toBeLessThan(0.02);
      expect(Math.abs(at.y - (p[1] - half[1])), `${state} frame ${k}: y`).toBeLessThan(0.02);
      const f = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromRotationMatrix(r.root));
      const yaw = Math.atan2(f.x, f.z);
      expect(Math.abs(Math.atan2(Math.sin(yaw - heading), Math.cos(yaw - heading))), `${state} frame ${k}: heading`).toBeLessThan(0.05);
      expect(new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromRotationMatrix(r.root)).y, `${state} frame ${k}: upright`).toBeGreaterThan(0.95);
    }
  }
}

describe('Fetch view: the first frame is where the simulation has it', () => {
  test('a fresh view, Fetch standing on its tape', () => check('idle', 0, 0.4));
  test('a fresh view created while Fetch is mid-roll', () => check('roll', 1.2, Math.PI / 2));
});
