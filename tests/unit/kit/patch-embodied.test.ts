// Patch drawn from a real body (the 2026-11-20 prototype; view/kit/pieces/patch-felt/embodied.ts and what the rig
// was given for it): a placement by quaternion is the same placement as by three angles and never unwinds; the squash
// keeps the figure's volume and the point it is about; the streaming tail points where it is told and never through
// the body; a takeover starts exactly where the figure was drawn and ends exactly on its target; the get-up starts
// from how it lay and ends sat where the simulation has it, with no frame that jumps.
import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { STREAM_CONE, bodyMatrix, poseMatrices, type PatchPose } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import { SEATED, resolvePose, shakeOff, toPose } from '../../../src/workshop/view/kit/pieces/patch-felt/perform.ts';
import { CORE, flung, gettingUp, intoBody, mixPlace, offsetOf, offsetSize, placeOf, placed, withOffset, type Place, type Q4 } from '../../../src/workshop/view/kit/pieces/patch-felt/embodied.ts';

type V3 = [number, number, number];
const q4 = (x: number, y: number, z: number): Q4 => {
  const q = new Quaternion().setFromEuler(new Euler(x, y, z, 'YXZ'));
  return [q.x, q.y, q.z, q.w];
};
const far = (a: Matrix4, b: Matrix4): number => Math.max(...a.elements.map((e, i) => Math.abs(e - b.elements[i]!)));
const angle = (a: Q4, b: Q4): number => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

describe('a placement by quaternion', () => {
  it('is the same placement as by three angles', () => {
    for (const [pitch, yaw, roll] of [[0.3, -1.1, 0.2], [2.9, 0.4, -1.3], [-1.2, 3.0, 0.7]] as const) {
      const euler = bodyMatrix({ at: [0.4, 0.9, -0.2], rot: [pitch, yaw, roll] });
      const q = new Quaternion().setFromRotationMatrix(euler);
      expect(far(bodyMatrix({ at: [0.4, 0.9, -0.2], quat: [q.x, q.y, q.z, q.w] }), euler)).toBeLessThan(1e-9);
    }
  });

  it('round-trips through a middle and a turn, and puts the middle of the trunk where it is told', () => {
    const p: Place = { mid: [1.2, 0.7, -0.4], q: q4(2.2, -0.6, 1.9) };
    const back = placeOf(placed(p));
    expect(Math.hypot(back.mid[0] - p.mid[0], back.mid[1] - p.mid[1], back.mid[2] - p.mid[2])).toBeLessThan(1e-9);
    expect(angle(back.q, p.q)).toBeLessThan(1e-6);
    const mid = new Vector3(0, CORE, 0).applyMatrix4(bodyMatrix(placed(p)));
    expect(mid.distanceTo(new Vector3(...p.mid))).toBeLessThan(1e-9);
  });

  it('a body turning head over heels for ten turns is drawn each frame where it is: no angle to unwind', () => {
    let last: Matrix4 | null = null;
    for (let i = 0; i <= 600; i++) {
      const a = (i / 600) * 20 * Math.PI;
      const m = bodyMatrix(placed({ mid: [0, 1, 0], q: q4(a, 0.3, 0.1 * Math.sin(a)) }));
      // (from one frame to the next: a tenth of a radian's worth, never a turn's)
      if (last) expect(far(m, last)).toBeLessThan(0.25);
      last = m;
    }
  });

  it('a blend out of it starts from the same placement (three angles for the blend, the same matrix)', () => {
    const body = placed({ mid: [0.5, 0.4, 0.3], q: q4(1.9, 0.8, -0.4) });
    expect(far(bodyMatrix(toPose(resolvePose({ ...SEATED, body })).body), bodyMatrix(body))).toBeLessThan(1e-6);
  });
});

describe('squash and stretch', () => {
  it('keeps the volume and the point it is about, and is by the stated amount along the stated way', () => {
    const p: Place = { mid: [0.3, 0.8, 0.1], q: q4(0.7, 0.2, -0.5) };
    const along: V3 = [0.6, 0.8, 0];
    for (const by of [0.72, 0.9, 1.1, 1.16]) {
      const plain = bodyMatrix(placed(p)), m = bodyMatrix(placed(p, { along, by, about: p.mid }));
      expect(m.determinant() / plain.determinant()).toBeCloseTo(1, 6);
      expect(new Vector3(0, CORE, 0).applyMatrix4(m).distanceTo(new Vector3(...p.mid))).toBeLessThan(1e-9);
      // a point one unit along the way from the middle is `by` from it after
      const a = new Vector3(...along).normalize();
      const inv = plain.clone().invert();
      const local = new Vector3(...p.mid).add(a).applyMatrix4(inv);
      expect(local.applyMatrix4(m).distanceTo(new Vector3(...p.mid))).toBeCloseTo(by, 6);
    }
  });

  it('with no squash the body is exactly as it was', () => {
    const b = { at: [0.1, 0.2, 0.3] as V3, rot: [0.3, 1.0, -0.2] as V3 };
    expect(far(bodyMatrix({ ...b, squash: { along: [0, 1, 0], by: 1, about: [0, 0, 0] } }), bodyMatrix(b))).toBe(0);
  });
});

describe('the streaming tail', () => {
  const tip = (pose: PatchPose): Vector3 => {
    const ms = poseMatrices(pose);
    const m = new Matrix4().multiply(ms.tail!).multiply(ms.tail2!).multiply(ms.tail3!).multiply(ms.tail4!);
    const root = new Vector3().applyMatrix4(ms.tail!);
    return new Vector3(0, 0.13, 0).applyMatrix4(m).sub(root).normalize();
  };

  it('without a stream the tail is exactly as it was', () => {
    const a = poseMatrices({ ...SEATED, tail: [0.4, -0.3], tailLift: 0.5 }), b = poseMatrices({ ...SEATED, tail: [0.4, -0.3], tailLift: 0.5, stream: { dir: [0, 1, 0], w: 0 } });
    for (const n of ['tail', 'tail2', 'tail3', 'tail4']) expect(far(a[n]!, b[n]!)).toBe(0);
  });

  it('at full weight it lies along the way it is told, for every way behind, above, below and beside the body', () => {
    for (const dir of [[0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0.5, 0.5, -0.7]] as V3[]) {
      const d = new Vector3(...dir).normalize();
      expect(tip({ ...SEATED, tail: [0, 0], stream: { dir, w: 1 } }).dot(d), dir.join(',')).toBeGreaterThan(0.85);
    }
  });

  it('never points through the body: told to stream forward it stops at the cone, and swinging through "forward" it never jumps', () => {
    const fwd = tip({ ...SEATED, tail: [0, 0], stream: { dir: [0, 0.01, 1], w: 1 } });
    expect(Math.acos(fwd.dot(new Vector3(0, 0, -1)))).toBeLessThan(STREAM_CONE + 0.45);
    // round the body head over heels (the way a tumble swings it), away from the exact forward where it flips over
    let last: Vector3 | null = null;
    for (let i = 0; i <= 200; i++) {
      const a = -2.6 + (5.2 * i) / 200; // from below-forward round the back to above-forward
      const t = tip({ ...SEATED, tail: [0, 0], stream: { dir: [0, Math.sin(a), -Math.cos(a)], w: 1 } });
      if (last) expect(t.distanceTo(last)).toBeLessThan(0.08);
      last = t;
    }
  });
});

describe('a takeover starts from the pose it was drawn in', () => {
  it('all of the offset is where it was drawn, none of it is the target, and between it turns the short way', () => {
    const drawn: Place = { mid: [1, 0.5, 0], q: q4(2.8, 0.2, 0.4) }, target: Place = { mid: [1.3, 0.3, -0.2], q: q4(-0.05, 1.4, 0) };
    const o = offsetOf(drawn, target);
    const at1 = withOffset(target, o, 1), at0 = withOffset(target, o, 0);
    expect(Math.hypot(at1.mid[0] - drawn.mid[0], at1.mid[1] - drawn.mid[1], at1.mid[2] - drawn.mid[2])).toBeLessThan(1e-9);
    expect(angle(at1.q, drawn.q)).toBeLessThan(1e-6);
    expect(angle(at0.q, target.q)).toBeLessThan(1e-6);
    const whole = offsetSize(o).turn;
    expect(whole).toBeLessThanOrEqual(Math.PI + 1e-9);
    let last = 0;
    for (let i = 1; i <= 10; i++) {
      const k = 1 - i / 10;
      const a = angle(withOffset(target, o, k).q, drawn.q);
      expect(a).toBeGreaterThanOrEqual(last - 1e-9);
      expect(a).toBeLessThanOrEqual(whole + 1e-6);
      last = a;
    }
  });
});

describe('the get-up from how it lay', () => {
  const visitor: V3 = [2, 1, 6];
  const from: V3 = [1, 0, 0.5], to: V3 = [1.6, 0, 0.9];
  const lie: Place = { mid: [1, 0.2, 0.5], q: q4(1.5, 0.4, 0.2) };
  const limbs = flung({ t: 1.2, trail: [0, 0, 0], spin: 0 });
  const opts = (feet: V3, length: number) => ({ lie, limbs, rise: 0.4, from, to, feet, length, yaw: 0.6, visitor });

  it('starts as it lay and ends sat where the simulation has its feet; with no hop, it sits up where it lay', () => {
    const a = gettingUp(0, opts(from, 0.4));
    expect(Math.hypot(a.place.mid[0] - lie.mid[0], a.place.mid[1] - lie.mid[1], a.place.mid[2] - lie.mid[2])).toBeLessThan(1e-6);
    expect(angle(a.place.q, lie.q)).toBeLessThan(1e-6);
    const sat = placeOf(shakeOff(0, from, 0.6, { visitor }).body);
    const b = gettingUp(0.4, { ...opts(from, 0.4), to: from });
    expect(Math.hypot(b.place.mid[0] - sat.mid[0], b.place.mid[1] - sat.mid[1], b.place.mid[2] - sat.mid[2])).toBeLessThan(1e-6);
    expect(angle(b.place.q, sat.q)).toBeLessThan(1e-6);
    expect(b.squash).toBe(1);
  });

  it('with a hop: a crouch before it, a stretch off the bench, and it ends sat at the place; no frame jumps', () => {
    const length = 0.4 + 0.36;
    const feetAt = (t: number): V3 => {
      const k = Math.min(1, Math.max(0, (t - 0.4) / (length - 0.4)));
      return [from[0] + (to[0] - from[0]) * k, 4 * 0.35 * k * (1 - k), from[2] + (to[2] - from[2]) * k];
    };
    let last: Place | null = null;
    let low = 1, high = 1;
    for (let i = 0; i <= 152; i++) {
      const t = (length * i) / 152;
      const g = gettingUp(t, opts(feetAt(t), length));
      low = Math.min(low, g.squash);
      high = Math.max(high, g.squash);
      if (last) {
        // (a 200th of a second at a time: never more than a few hundredths of a unit, or a tenth of a radian)
        expect(Math.hypot(g.place.mid[0] - last.mid[0], g.place.mid[1] - last.mid[1], g.place.mid[2] - last.mid[2]), `t ${t.toFixed(3)}`).toBeLessThan(0.05);
        expect(angle(g.place.q, last.q), `t ${t.toFixed(3)}`).toBeLessThan(0.12);
      }
      last = g.place;
    }
    expect(low).toBeLessThan(0.9); // the crouch
    expect(high).toBeGreaterThan(1.1); // the stretch
    const end = gettingUp(length, opts(to, length));
    const sat = placeOf(shakeOff(0, to, 0.6, { visitor }).body);
    expect(Math.hypot(end.place.mid[0] - sat.mid[0], end.place.mid[1] - sat.mid[1], end.place.mid[2] - sat.mid[2])).toBeLessThan(1e-6);
    expect(angle(end.place.q, sat.q)).toBeLessThan(1e-6);
    expect(end.squash).toBeCloseTo(1, 6);
  });

  it('down hard from a fall it flops however it lies: flat (stopped upright: over onto its front), a beat, and up sat; no frame jumps', () => {
    const upright: Place = placeOf(shakeOff(0, from, 0.6, { visitor }).body);
    const o = { ...opts(from, 1.1), lie: upright, rise: 1.1, to: from, flop: { fall: 5 } };
    const up = (p: Place): number => new Vector3(0, 1, 0).applyQuaternion(new Quaternion(p.q[0], p.q[1], p.q[2], p.q[3])).y;
    expect(up(gettingUp(0, o).place)).toBeGreaterThan(0.95);
    // flat on its front by a quarter of a second, still flat at the half, and sat up at the end
    expect(up(gettingUp(0.3, o).place)).toBeLessThan(0.3);
    expect(up(gettingUp(0.55, o).place)).toBeLessThan(0.3);
    const end = gettingUp(1.1, o).place;
    expect(up(end)).toBeGreaterThan(0.95);
    expect(Math.hypot(end.mid[0] - upright.mid[0], end.mid[2] - upright.mid[2])).toBeLessThan(0.05);
    let last: Place | null = null;
    for (let i = 0; i <= 220; i++) {
      const g = gettingUp((1.1 * i) / 220, o).place;
      if (last) {
        expect(Math.hypot(g.mid[0] - last.mid[0], g.mid[1] - last.mid[1], g.mid[2] - last.mid[2]), `step ${i}`).toBeLessThan(0.05);
        expect(angle(g.q, last.q), `step ${i}`).toBeLessThan(0.12);
      }
      last = g;
    }
    // lying on its side, or on its back: flat too (the nearer of its front and its back), and up sat the same
    for (const q of [q4(1.5, 0.4, 0.2), q4(-1.3, 0.2, 0.1), q4(0.2, 1, 1.5)]) {
      const on = { ...o, lie: { mid: [1, 0.2, 0.5] as V3, q } };
      const flat = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...gettingUp(0.4, on).place.q)).y;
      expect(Math.abs(flat)).toBeGreaterThan(0.97);
      expect(up(gettingUp(1.1, on).place)).toBeGreaterThan(0.95);
    }
  });

  it('the visitor is where they are in its own frame, however it is turned', () => {
    const p: Place = { mid: [0.4, 0.9, 0.2], q: q4(2.5, -0.9, 0.6) };
    const v = intoBody(p, visitor);
    const back = new Vector3(...v).applyMatrix4(bodyMatrix(placed(p)));
    expect(back.distanceTo(new Vector3(...visitor))).toBeLessThan(1e-9);
    void mixPlace;
  });
});
