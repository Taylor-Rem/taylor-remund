import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import * as PF from '../../../src/workshop/view/kit/pieces/patch-felt/perform.ts';
import { EXPRESSIONS, HC, NEUTRAL, poseMatrices } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import type { PatchPose } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import { BOARD_WHOLE } from '../../../src/workshop/view/kit/pieces/switchboard/board.ts';
import { PATCH_TUNING } from '../../../src/workshop/sim/index.ts';
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
      // each is the simulation's own stage (catch: a tug of the paw home after it, still inside 1.5 s)
      expect(close(f(1.5), f(3.5), 1e-3), `${nm} done by 1.5 s`).toBe(true);
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
    const sAt = (n: PF.JobStage, u: number): number => { const st = PF.JOB_STAGES.find((x) => x.name === n)!; return st.at + st.dur * u; };
    expect(PF.job(sAt('work', 0.5), T).drawer).toBe(1);
    expect(PF.job(PF.JOB_LENGTH, T).drawer).toBe(0);
    expect(PF.job(sAt('drawer', 0.5), T).pose.folder ?? 0).toBeLessThan(0.5);
    expect(PF.job(sAt('work', 0.5), T).pose.folder ?? 0).toBeGreaterThanOrEqual(0.5);
    // the stages are the simulation's own lengths: played at natural speed
    expect(PF.JOB_STAGES.slice(0, 4).map((x) => x.dur)).toEqual([PATCH_TUNING.drawer, PATCH_TUNING.work, PATCH_TUNING.check, PATCH_TUNING.reply]);
    expect(PF.job(PF.JOB_LENGTH, T).pose.folder ?? 0).toBeLessThan(0.5);
    // a stage can be driven by u, and reversing u retraces it
    expect(close(PF.jobStage('check', 0.3, T).pose, PF.job(sAt('check', 0.3), T).pose)).toBe(true);
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
    // it ends exactly on the shelf the simulation gives, so nothing jumps when the simulation takes over
    const shelf: PF.V3 = [-0.4, 0.15, 0.5];
    const end = PF.catchCrate(PF.CATCH_LENGTH, { shelf }).crate!;
    expect(Math.hypot(end[0] - shelf[0], end[1] - shelf[1], end[2] - shelf[2])).toBeLessThan(1e-6);
    const near = PF.catchCrate(PF.CATCH_LENGTH - 0.02, { shelf }).crate!;
    expect(Math.hypot(near[0] - shelf[0], near[1] - shelf[1], near[2] - shelf[2])).toBeLessThan(0.15);
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

describe('the facepalm', () => {
  const forearmMid = (p: PatchPose, nm: 'L' | 'R'): Vector3 => new Vector3(0, -0.06, 0.03).applyMatrix4(PF.nodeMatrix(p, ['body', 'spine', `arm${nm}`, `forearm${nm}`]));
  const muzzle = (p: PatchPose): Vector3 => new Vector3(HC[0], HC[1] - 0.06, HC[2] + 0.3).applyMatrix4(PF.nodeMatrix(p, ['body', 'spine', 'head']));
  it('held: the sleeve lies across the muzzle, the ears are flat, the body has sunk and the tail droops', () => {
    for (const variant of ['one', 'both'] as const) {
      const p = PF.resolvePose(PF.facepalm(1.9, { variant }));
      expect(forearmMid(p, 'L').distanceTo(muzzle(p))).toBeLessThan(0.16);
      if (variant === 'both') expect(forearmMid(p, 'R').distanceTo(muzzle(p))).toBeLessThan(0.2);
      expect(Math.min(...p.ears)).toBeGreaterThan(0.9);
      expect(p.body.at?.[1] ?? 0).toBeLessThan(-0.03);
      expect(p.tailLift).toBeLessThan(-0.5);
    }
  });
  it('the sigh: the body rises and sinks again while it is held', () => {
    // (no glance: the facepalm runs 0.1..2.55 s; slumped at 1.2, the sigh's top at 1.47, lower again at 1.82)
    const ys = [1.2, 1.47, 1.82].map((t) => PF.resolvePose(PF.facepalm(t)).body.at?.[1] ?? 0);
    expect(ys[1]!).toBeGreaterThan(ys[0]! + 0.01);
    expect(ys[2]!).toBeLessThan(ys[1]! - 0.01);
  });
  it('the ears come up one at a time on the peek, and everything is back on the stool at the end', () => {
    const peek = PF.resolvePose(PF.facepalm(2.1));
    expect(Math.abs(peek.ears[0] - peek.ears[1])).toBeGreaterThan(0.3);
    const end = PF.resolvePose(PF.facepalm(3));
    expect(Math.abs(end.body.at?.[1] ?? 0)).toBeLessThan(2e-3);
    expect(end.armScale).toEqual([1, 1]);
  });
});

describe('over the edge (R1)', () => {
  it('a paw holds the edge all through the hang (front and side); hauled, it stands at `up`; every pose is finite', () => {
    for (const front of [true, false]) {
      const o = { at: [0.5, -0.43, 2.5] as PF.V3, up: [0.5, -0.43, 2.27] as PF.V3, heading: Math.PI, front };
      for (const t of [0, 0.3, 0.6, 1.0, 1.3, 1.6]) {
        const p = PF.overTheEdge('ledge', t, o);
        expect(finite(p)).toBe(true);
        const l = PF.pawPoint(p, 'left'), r = PF.pawPoint(p, 'right');
        const near = Math.min(Math.hypot(l[0] - o.at[0], l[1] - o.at[1], l[2] - o.at[2]), Math.hypot(r[0] - o.at[0], r[1] - o.at[1], r[2] - o.at[2]));
        expect(near).toBeLessThan(0.2);
        expect(PF.headPoint(p)[1]).toBeLessThan(o.at[1] + 0.2); // hanging: the head no higher than just over the edge
      }
      for (const t of [0, 0.35, 0.7]) expect(finite(PF.overTheEdge('haul', t, o))).toBe(true);
      for (const t of [0, 0.25, 0.5]) expect(finite(PF.overTheEdge('dust', t, o))).toBe(true);
      const up = PF.resolvePose(PF.overTheEdge('haul', PF.HAUL_LENGTH, o));
      expect(Math.hypot(up.body.at[0] - o.up[0], up.body.at[2] - o.up[2])).toBeLessThan(1e-6);
      expect(up.body.at[1]).toBeGreaterThan(o.up[1]);
    }
  });
  it('off the front it turns on one paw and gives the visitor the look; off a side it does not turn', () => {
    const o = { at: [0.5, -0.43, 2.5] as PF.V3, up: [0.5, -0.43, 2.27] as PF.V3, heading: Math.PI, front: true };
    const turned = PF.resolvePose(PF.overTheEdge('ledge', 1.15, o));
    expect(Math.abs(turned.body.rot[1] - Math.PI)).toBeGreaterThan(0.5);
    expect(turned.brows[0]).toBeLessThan(-0.4);
    const side = PF.resolvePose(PF.overTheEdge('ledge', 1.15, { ...o, front: false }));
    expect(Math.abs(side.body.rot[1] - Math.PI)).toBeLessThan(1e-6);
  });
});

describe('thrown (R4)', () => {
  const mid: PF.V3 = [1, 0.6, 1];
  it('the tumble turns about its middle: wherever it has turned to, its middle is where the simulation has it', () => {
    for (const spin of [0, 1, 2.5, 4]) {
      const p = PF.tumble(0.3, mid, spin, 0.4);
      expect(finite(p)).toBe(true);
      const m = new Vector3(0, 0.3, 0).applyMatrix4(PF.nodeMatrix(p, ['body']));
      expect(m.distanceTo(new Vector3(...mid))).toBeLessThan(1e-6);
    }
  });
  it('the landing, the shake and the wall are finite throughout and end sat up', () => {
    for (const t of [0, 0.2, 0.5, 0.8]) expect(finite(PF.landed(t, [1, -0.43, 1], 0.3, 2, 5))).toBe(true);
    for (const t of [0, 0.3, 0.6]) expect(finite(PF.shakeOff(t, [1, -0.43, 1], 0.3))).toBe(true);
    for (const t of [0, 0.1, 0.25, 0.6]) expect(finite(PF.splat(t, mid, 0.3, 0.25))).toBe(true);
    const end = PF.resolvePose(PF.landed(PF.LAND_LENGTH, [1, -0.43, 1], 0.3, 2, 5));
    expect(Math.abs(end.body.rot[0])).toBeLessThan(0.2); // upright
    expect(end.body.at[1]).toBeLessThan(-0.3); // down on the bench, not on the stool
  });
  it('off a wall it keeps one facing from the first frame stuck to the last of the landing (face to the room)', () => {
    // the wall's normal (out of the wall, toward the room) is the body's yaw: +Z in the body at yaw 0
    const n = new Vector3(0, 0, 1);
    const facing = (p: PatchPose): number[] => {
      const out: number[] = [];
      for (const path of [['body'], ['body', 'spine', 'head']]) {
        const m = PF.nodeMatrix(p, path);
        const o = new Vector3().applyMatrix4(m);
        out.push(new Vector3(0, 0, 1).applyMatrix4(m).sub(o).dot(n));
      }
      return out;
    };
    const feet: PF.V3 = [1, -0.43, 1];
    const poses = [
      ...[0.01, 0.1, 0.2, 0.25, 0.4, 0.6].map((t) => PF.splat(t, mid, 0, 0.25)),
      ...[0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, PF.LAND_LENGTH].map((t) => PF.landed(t, feet, 0, 0, 0, true)),
      PF.shakeOff(0.3, feet, 0),
    ];
    for (const p of poses) for (const d of facing(p)) expect(d).toBeGreaterThan(0.5);
  });
  it('stuck to the wall it quivers in place; then it slides with its arms dragged up', () => {
    const a = PF.resolvePose(PF.splat(0.1, mid, 0.3, 0.25));
    const b = PF.resolvePose(PF.splat(0.6, mid, 0.3, 0.25));
    expect(b.arms.left.swing).toBeGreaterThan(a.arms.left.swing);
  });
});
