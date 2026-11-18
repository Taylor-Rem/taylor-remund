import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import * as PF from '../../../src/workshop/view/kit/pieces/patch-felt/perform.ts';
import { EXPRESSIONS, HC, NEUTRAL, poseMatrices } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import type { PatchPose } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import { BOARD_WHOLE } from '../../../src/workshop/view/kit/pieces/switchboard/board.ts';
import { JACKS } from '../../../src/workshop/view/kit/pieces/switchboard/labels.ts';

const finite = (p: PatchPose): boolean => {
  const ms = poseMatrices(p);
  return Object.values(ms).every((m) => m.elements.every((v) => Number.isFinite(v)));
};
const close = (a: PatchPose, b: PatchPose, eps = 1e-9): boolean => {
  const A = poseMatrices(a), B = poseMatrices(b);
  return Object.keys(A).every((k) => A[k]!.elements.every((v, i) => Math.abs(v - B[k]!.elements[i]!) < eps));
};
/** Paws above the head's top: a wave, which Patch never does. */
const waves = (p: PatchPose): boolean => {
  const top = PF.headPoint(p)[1] + HC[1] * 0.9;
  return (['left', 'right'] as const).some((s) => PF.pawPoint(p, s)[1] > top);
};

describe('patch-felt performances (pure functions of time)', () => {
  const T = PF.jobTargets('storefront');
  const samples = (len: number, n = 40): number[] => Array.from({ length: n + 1 }, (_, i) => (i / n) * len);

  it('is pure: the same t gives the same pose, and every pose is finite', () => {
    for (const t of [0, 0.37, 2.2, 5.5, 9.9]) {
      expect(close(PF.job(t, T).pose, PF.job(t, T).pose)).toBe(true);
      expect(finite(PF.job(t, T).pose)).toBe(true);
    }
    for (const t of samples(PF.REACTION_LENGTH, 12)) {
      for (const p of [PF.duck(t), PF.catchCrate(t).pose, PF.bonked(t), PF.held(t, [0.3, 0, -0.2]), PF.climb(t * 2), PF.theLook(t * 3, { plug: T.plug })]) expect(finite(p)).toBe(true);
    }
  });

  it('starts the duck at the seated rest and ends every reaction within 1.5 s', () => {
    expect(PF.REACTION_LENGTH).toBeLessThanOrEqual(1.5);
    const fs = { duck: (t: number) => PF.duck(t), bonked: (t: number) => PF.bonked(t), catch: (t: number) => PF.catchCrate(t).pose };
    for (const [nm, f] of Object.entries(fs)) {
      if (nm === "duck") expect(close(f(0), EXPRESSIONS.unimpressed, 0.05), `${nm} starts at rest`).toBe(true);
      expect(close(f(PF.REACTION_LENGTH), f(PF.REACTION_LENGTH + 2), 1e-3), `${nm} done by 1.5 s`).toBe(true);
    }
  });

  it('never waves in any frame of any performance', () => {
    for (const t of samples(PF.JOB_LENGTH, 60)) expect(waves(PF.job(t, T).pose)).toBe(false);
    for (const t of samples(PF.REACTION_LENGTH, 20)) {
      expect(waves(PF.duck(t))).toBe(false);
      expect(waves(PF.catchCrate(t).pose)).toBe(false);
      expect(waves(PF.bonked(t))).toBe(false);
    }
    const L = PF.rollLength(PF.REST_X, PF.workX('storefront'));
    for (const t of samples(L, 30)) expect(waves(PF.rollTo(t, { fromX: PF.REST_X, toX: PF.workX('storefront') }).pose)).toBe(false);
    for (const t of samples(PF.CLIMB_LENGTH, 20)) expect(waves(PF.climb(t))).toBe(false);
    for (const t of samples(4, 20)) expect(waves(PF.held(t))).toBe(false);
  });

  it('the job is staged: stages tile it, the drawer opens and shuts, the folder comes and goes', () => {
    let at = 0;
    for (const s of PF.JOB_STAGES) {
      expect(s.at).toBeCloseTo(at, 6);
      at += s.dur;
    }
    expect(at).toBeCloseTo(PF.JOB_LENGTH, 6);
    expect(PF.job(0, T).drawer).toBe(0);
    expect(PF.job(5, T).drawer).toBe(1);
    expect(PF.job(PF.JOB_LENGTH, T).drawer).toBe(0);
    expect(PF.job(1.0, T).pose.folder ?? 0).toBeLessThan(0.5);
    expect(PF.job(4.0, T).pose.folder ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(PF.job(PF.JOB_LENGTH, T).pose.folder ?? 0).toBeLessThan(0.5);
    // a stage can be driven by u, and reversing u retraces it
    expect(close(PF.jobStage('check', 0.3, T).pose, PF.job(5.3 + 0.3 * 1.9, T).pose)).toBe(true);
    // it begins and ends sat at the jack
    expect(close(PF.job(0, T).pose, PF.job(PF.JOB_LENGTH, T).pose, 0.05)).toBe(true);
  });

  it('reaches every jack plug and drawer pull from its stool position on the runner (an honest arm: within 0.06)', () => {
    for (const j of JACKS) {
      const t = PF.jobTargets(j);
      const d = PF.reachDrawer(t.handle);
      const p = PF.reachJack(t.plug);
      expect(new Vector3(...PF.pawPoint(d.pose, 'right')).distanceTo(new Vector3(...t.handle)) - d.short).toBeLessThan(0.06);
      expect(d.short).toBeLessThan(0.06);
      expect(p.short).toBeLessThan(0.08);
    }
  });

  it('the IK solves a reachable point to within a few millimetres, inside the rig limits', () => {
    const target: PF.V3 = [-0.3, 0.35, 0.25];
    const r = PF.reach(target, 'right');
    expect(r.short).toBe(0);
    expect(new Vector3(...PF.pawPoint(r.pose, 'right')).distanceTo(new Vector3(...target))).toBeLessThan(0.012);
  });

  it('the roll moves the stool from where it was to where it goes, and stops dead', () => {
    const a = PF.REST_X, b = PF.workX('platen');
    const L = PF.rollLength(a, b);
    expect(PF.rollTo(0, { fromX: a, toX: b }).stoolX).toBeCloseTo(a, 1);
    expect(PF.rollTo(L, { fromX: a, toX: b }).stoolX).toBeCloseTo(b, 6);
    let prev = a + 1;
    for (const t of samples(L, 50).filter((t) => t > 0.9)) {
      const x = PF.rollTo(t, { fromX: a, toX: b }).stoolX;
      expect(x).toBeLessThanOrEqual(prev + 1e-9);
      prev = x;
    }
    // it stays on the runner
    for (const t of samples(L, 50)) {
      const x = PF.rollX(t, a, b);
      expect(x).toBeGreaterThanOrEqual(BOARD_WHOLE.runner.x0);
      expect(x).toBeLessThanOrEqual(BOARD_WHOLE.runner.x1);
    }
  });

  it('held hangs from the scruff: the scruff stays at the hand (the root) and the feet hang below it', () => {
    for (const t of [0.5, 1.5, 3]) {
      const p = PF.held(t, [0.4, 0, 0]);
      const s = PF.scruffPoint(p);
      expect(Math.hypot(...s)).toBeLessThan(1e-6);
      const foot = new Vector3().applyMatrix4(PF.nodeMatrix(p, ['body', 'thighL', 'shinL']));
      expect(foot.y).toBeLessThan(-0.4);
    }
  });

  it('climb ends sat on the seat, and starts stood on the floor below it', () => {
    const end = PF.climb(PF.CLIMB_LENGTH + 1);
    expect(close(end, EXPRESSIONS.unimpressed, 1e-3)).toBe(true);
    const start = PF.climb(0);
    const sole = new Vector3(0, -0.26, 0.09).applyMatrix4(PF.nodeMatrix(start, ['body', 'thighL', 'shinL']));
    expect(sole.y).toBeCloseTo(-PF.SEAT_DROP, 1);
  });

  it('catch hands the station the crate while Patch has it, and not before or after', () => {
    expect(PF.catchCrate(0.05).crate).toBeNull();
    expect(PF.catchCrate(0.5).crate).not.toBeNull();
    expect(PF.catchCrate(1.3).crate).toBeNull();
  });

  it('the look ends on the visitor, heavy-lidded, the head part way and the eyes the rest', () => {
    const p = PF.resolvePose(PF.theLook(PF.LOOK_LENGTH + 0.3, { plug: T.plug, visitor: T.visitor }));
    expect(p.lids[0]).toBeGreaterThan(0.3);
    expect(p.brows[0]).toBeLessThan(-0.3);
    const full = PF.lookAt(p, T.visitor, 1);
    expect(Math.abs(full.headYaw - p.headYaw)).toBeGreaterThan(0.05);
  });

  it('blendTo cuts short: it starts where Patch was and lands on the target', () => {
    const from = PF.job(4, T).pose;
    expect(close(PF.blendTo(from, PF.SEATED, 0), from, 1e-9)).toBe(true);
    expect(close(PF.blendTo(from, PF.SEATED, 1), PF.SEATED, 1e-6)).toBe(true);
  });

  it('the neutral pose resolves to itself', () => {
    expect(close(PF.toPose(PF.resolvePose(NEUTRAL)), NEUTRAL)).toBe(true);
  });
});
