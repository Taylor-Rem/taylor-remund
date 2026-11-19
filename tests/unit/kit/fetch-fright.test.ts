import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { frightened } from '../../../src/workshop/view/kit/pieces/fetch-porter/fright.ts';
import { held } from '../../../src/workshop/view/kit/pieces/fetch-porter/perform.ts';
import { TORSO, poseMatrices, type FetchPose } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';

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

describe('fetch-porter: frightened by a Button rung', () => {
  it('is the whole pose while the rung plays, and gone before the card comes up at the end of the rewind', () => {
    for (const rung of [1, 2, 3, 4]) {
      const play = frightened({ phase: 'playing', t: 1.5, rewind: 2, rung, presses: rung });
      expect(play.weight).toBe(1);
      expect(handsOutside(play.pose), `rung ${rung}`).toBe(true);
      expect(frightened({ phase: 'rewinding', t: 1.8, rewind: 2, rung, presses: rung }).weight).toBeLessThan(0.02);
    }
  });

  it('is different from one press to the next, and rung 4 hides its eye', () => {
    const a = frightened({ phase: 'playing', t: 1, rewind: 2, rung: 1, presses: 1 }).pose;
    const b = frightened({ phase: 'playing', t: 1, rewind: 2, rung: 2, presses: 2 }).pose;
    expect(JSON.stringify(a.arms)).not.toBe(JSON.stringify(b.arms));
    const h = frightened({ phase: 'playing', t: 0.5, rewind: 2, rung: 4, presses: 4 }).pose;
    const arms = h.arms as { left: { tele?: number } };
    expect(arms.left.tele).toBeGreaterThan(0.1); // the tubes run out to bring the claws in front of the eye
  });

  it('reduced motion: a pose (no hop, no shiver)', () => {
    const a = frightened({ phase: 'playing', t: 0.13, rewind: 2, rung: 1, presses: 1, reducedMotion: true }).pose;
    const b = frightened({ phase: 'playing', t: 1.77, rewind: 2, rung: 1, presses: 1, reducedMotion: true }).pose;
    expect(a.lift).toBe(0);
    expect(b.lean![1]).toBe(0);
  });
});

describe('fetch-porter: lifted, it flails', () => {
  it('paddles hard after the lift and in a burst when shaken, and dangles later', () => {
    const swing = (p: FetchPose): number => (p.arms as { left: { swing: number } }).left.swing;
    const spread = (f: (t: number) => FetchPose, t0: number): number => {
      let lo = Infinity, hi = -Infinity;
      for (let t = t0; t < t0 + 0.5; t += 0.02) {
        const s = swing(f(t));
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      return hi - lo;
    };
    const still = (t: number): FetchPose => held(t);
    const shaken = (t: number): FetchPose => held(t, { carry: [3, 0, 0] });
    expect(spread(still, 0.2)).toBeGreaterThan(spread(still, 6.05) * 2);
    expect(spread(shaken, 6.05)).toBeGreaterThan(spread(still, 6.05) * 2);
  });
});
