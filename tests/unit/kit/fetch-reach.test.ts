import { describe, expect, it } from 'vitest';
import { TELE, TELE_MAX, handPoint, poseMatrices, teleStages } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import type { Arms } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import {
  GREATEST_REACH, GRIP_POINT, NATURAL_REACH, REACH_HEIGHT, ReachMotion, S_CRATE_HALF, gripOf, reachLimits, reachPose,
} from '../../../src/workshop/view/kit/pieces/fetch-porter/reach.ts';
import type { V3 } from '../../../src/workshop/view/kit/pieces/fetch-porter/reach.ts';

const dist = (a: { x: number; y: number; z: number }, b: V3): number => Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]);

describe('fetch-porter reach (telescoping forearms)', () => {
  it('reaches further with the tubes out, by about the telescope', () => {
    expect(NATURAL_REACH).toBeGreaterThan(0.5);
    expect(GREATEST_REACH).toBeGreaterThan(NATURAL_REACH + 0.18);
    expect(GREATEST_REACH).toBeLessThan(NATURAL_REACH + TELE_MAX + 0.05);
    // the numbers the scene is held to, at the bench's 1.5×
    expect(NATURAL_REACH * 1.5).toBeGreaterThan(0.78);
    expect(GREATEST_REACH * 1.5).toBeGreaterThan(1.15);
  });

  it('uses no telescope for a near reach, and puts the crate exactly there, level between both claws', () => {
    const t: V3 = [0.1, REACH_HEIGHT, 0.45];
    const r = reachPose(t, { half: S_CRATE_HALF });
    expect(r.tele).toBeLessThan(1e-3);
    expect(r.short).toBeLessThan(0.003);
    expect(dist(gripOf(r.pose, null), t)).toBeLessThan(0.004);
    const arms = r.pose.arms as Arms;
    const b = { lean: r.pose.lean, squash: r.pose.squash, spin: r.pose.spin };
    const L = handPoint(b, 'L', arms.left, GRIP_POINT), R = handPoint(b, 'R', arms.right, GRIP_POINT);
    expect(Math.abs(L.y - R.y)).toBeLessThan(1e-6);
    expect(L.distanceTo(R)).toBeGreaterThan(2 * S_CRATE_HALF[0]);
  });

  it('runs the tubes out beyond its natural reach, and says how far short it is beyond its greatest', () => {
    const mid = reachPose([0, REACH_HEIGHT, (NATURAL_REACH + GREATEST_REACH) / 2], { half: S_CRATE_HALF });
    expect(mid.short).toBeLessThan(0.003);
    expect(mid.tele).toBeGreaterThan(0.03);
    const far = reachPose([0, REACH_HEIGHT, GREATEST_REACH + 0.2], { half: S_CRATE_HALF });
    expect(far.tele).toBeCloseTo(TELE_MAX, 3);
    expect(far.short).toBeGreaterThan(0.15);
    expect(far.short).toBeLessThan(0.3);
  });

  it('taps with one claw', () => {
    const t: V3 = [0.25, 0.42, 0.55];
    const r = reachPose(t);
    expect(r.tap).toBe('left');
    expect(r.short).toBeLessThan(0.003);
    expect(dist(gripOf(r.pose, 'left'), t)).toBeLessThan(0.004);
  });

  it('draws the same arm as the solver (the rig and its forward kinematics agree)', () => {
    const r = reachPose([0, 0.6, 0.72], { half: S_CRATE_HALF });
    const ms = poseMatrices(r.pose);
    let m = ms.lean!.clone();
    for (const n of ['body', 'armL', 'forearmL', 'teleL1', 'teleL2', 'teleL3', 'handL']) m = m.multiply(ms[n]!);
    const viaRig = handPoint({ lean: r.pose.lean, squash: r.pose.squash, spin: r.pose.spin }, 'L', (r.pose.arms as Arms).left, GRIP_POINT);
    const e = m.elements;
    const x = e[12]! + e[4]! * GRIP_POINT[1], y = e[13]! + e[5]! * GRIP_POINT[1], z = e[14]! + e[6]! * GRIP_POINT[1];
    expect(Math.hypot(x - viaRig.x, y - viaRig.y, z - viaRig.z)).toBeLessThan(1e-6);
  });

  it('shares the run outer tube first, each to its stop', () => {
    expect(teleStages(0.05)).toEqual([0.05, 0, 0]);
    const s = teleStages(TELE.out[0] + 0.03);
    expect(s[0]).toBeCloseTo(TELE.out[0], 9);
    expect(s[1]).toBeCloseTo(0.03, 9);
    expect(teleStages(9)).toEqual([...TELE.out]);
  });

  it('reachLimits agrees with the exported numbers', () => {
    const l = reachLimits(REACH_HEIGHT, S_CRATE_HALF);
    expect(l.natural).toBeCloseTo(NATURAL_REACH, 6);
    expect(l.greatest).toBeCloseTo(GREATEST_REACH, 6);
  });

  it('plays a reach in order: arms first, then the tubes; back in first, then the arms; reduced motion never overshoots', () => {
    for (const rm of [false, true]) {
      const m = new ReachMotion();
      const far: V3 = [0, REACH_HEIGHT, GREATEST_REACH - 0.01];
      const tele: number[] = [];
      const weight: number[] = [];
      let maxStage = 0;
      for (let f = 0; f < 60; f++) {
        const o = m.update({ target: far, half: S_CRATE_HALF, holding: true, dt: 1 / 60, reducedMotion: rm });
        tele.push(o.tele);
        weight.push(o.weight);
        const arms = o.pose.arms as Arms;
        const st = arms.left.tele as readonly number[];
        maxStage = Math.max(maxStage, ...st.map((v, i) => v - TELE.out[i]!));
      }
      // the arms open before the tubes move
      expect(tele[3]).toBeLessThan(0.002);
      expect(tele[59]).toBeGreaterThan(TELE_MAX - 0.02);
      expect(weight[59]).toBeCloseTo(1, 2);
      if (rm) expect(maxStage).toBeLessThanOrEqual(1e-9);
      else expect(maxStage).toBeGreaterThan(0); // a hair past the stop
      // back: the tubes are in before the reach lets the arms go
      let w = 1, t = 1;
      let weightWhileOut = 1;
      for (let f = 0; f < 90; f++) {
        const o = m.update({ target: null, half: S_CRATE_HALF, holding: false, dt: 1 / 60, reducedMotion: rm });
        if (o.tele > 0.02) weightWhileOut = Math.min(weightWhileOut, o.weight);
        w = o.weight;
        t = o.tele;
      }
      expect(weightWhileOut).toBeGreaterThan(0.95);
      expect(t).toBeLessThan(1e-3);
      expect(w).toBeLessThan(0.05);
    }
  });
});
