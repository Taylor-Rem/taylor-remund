import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { jetpack, type JetpackOptions } from '../../../src/workshop/view/kit/pieces/fetch-porter/perform.ts';
import { TORSO, poseMatrices, type FetchPose } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';

const PHASES: JetpackOptions['phase'][] = ['fall', 'ignite', 'rise', 'cruise', 'hover', 'land'];
const THRUST: Record<JetpackOptions['phase'], number> = { fall: 0, ignite: 0.5, rise: 1, cruise: 0.7, hover: 0.5, land: 0.2 };

const handsOutside = (p: FetchPose): boolean => {
  const ms = poseMatrices(p);
  for (const s of ['L', 'R'] as const) {
    const m = new Matrix4();
    for (const n of [`arm${s}`, `forearm${s}`, `tele${s}1`, `tele${s}2`, `tele${s}3`, `hand${s}`]) m.multiply(ms[n]!);
    const h = new Vector3(0, -0.05, 0).applyMatrix4(m);
    if (Math.abs(h.x) < TORSO.w / 2 && h.y > TORSO.y0 && h.y < TORSO.lidTop && Math.abs(h.z) < TORSO.d / 2) return false;
  }
  return true;
};

describe('fetch-porter: the jetpack', () => {
  it('the flames follow the thrust (off in the fall, full in the rise), flickering about it', () => {
    for (const phase of PHASES) {
      let sum = 0, n = 0;
      for (let t = 0; t < 2; t += 0.01) {
        const p = jetpack({ phase, phaseTime: 0.1, phaseLength: 0.5, thrust: THRUST[phase], t });
        sum += p.jet![0] + p.jet![1];
        n += 2;
      }
      expect(sum / n, phase).toBeCloseTo(THRUST[phase], 1);
    }
    // reduced motion: a steady flame of the same size
    const a = jetpack({ phase: 'rise', phaseTime: 0.1, phaseLength: 0.5, thrust: 1, t: 0.13, reducedMotion: true });
    const b = jetpack({ phase: 'rise', phaseTime: 0.1, phaseLength: 0.5, thrust: 1, t: 0.71, reducedMotion: true });
    expect(a.jet).toEqual([1, 1]);
    expect(b.jet).toEqual([1, 1]);
    expect(b.lean).toEqual([0, 0]);
  });

  it('is a whole pose in every phase (every field finite, the hands outside the body)', () => {
    for (const phase of PHASES) {
      for (let t = 0; t < 1.5; t += 0.05) {
        const p = jetpack({ phase, phaseTime: t % 0.5, phaseLength: 0.5, thrust: THRUST[phase], t, sinceIgnite: t - 0.2, sinceCut: t - 1 });
        for (const k of ['lean', 'squash', 'brow', 'pupilSize', 'eyeScale', 'lids', 'arms', 'jet', 'puff'] as const) expect(p[k], `${phase} ${k}`).toBeDefined();
        expect(JSON.stringify(p)).not.toMatch(/null|NaN/);
        expect(handsOutside(p), `${phase} t=${t.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('a bigger puff at ignition than at the cut', () => {
    let ign = 0, cut = 0;
    for (let s = 0; s < 0.6; s += 0.01) {
      ign = Math.max(ign, jetpack({ phase: 'ignite', phaseTime: s, phaseLength: 0.25, thrust: 0.5, t: s, sinceIgnite: s }).puff!);
      cut = Math.max(cut, jetpack({ phase: 'land', phaseTime: s, phaseLength: 0.62, thrust: 0, t: s, sinceCut: s }).puff!);
    }
    expect(ign).toBeGreaterThan(cut * 1.5);
  });
});
