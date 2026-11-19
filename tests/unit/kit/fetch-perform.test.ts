import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { TORSO, contactPoint, poseMatrices } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import type { FetchPose } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import {
  KNOCK, LENGTHS, REST, blendPose, dizzy, handsUp, held, knocked, knockedLength, outOfLane, ring, salute, setDown, settle,
} from '../../../src/workshop/view/kit/pieces/fetch-porter/perform.ts';

/** Largest difference between two poses' node matrices (the whole rig; the wheel's and the pennant's phases are free). */
function distance(a: FetchPose, b: FetchPose): number {
  const ma = poseMatrices({ ...a, wheel: 0, flag: 0 }), mb = poseMatrices({ ...b, wheel: 0, flag: 0 });
  let d = 0;
  for (const k of Object.keys(ma)) {
    const ea = ma[k]!.elements, eb = mb[k]!.elements;
    for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(ea[i]! - eb[i]!));
  }
  return d;
}

const inBody = (ms: Record<string, Matrix4>, path: string[]): Matrix4 => {
  const out = new Matrix4();
  for (const n of path) out.multiply(ms[n]!);
  return out;
};

/** Every finite beat, at a few settings. */
const BEATS: Array<{ name: string; length: number; at: (t: number) => FetchPose }> = [
  ...(['nudge', 'knock', 'wallop'] as const).flatMap((s) =>
    ([[-1, 0.2], [1, 0], [0, 1], [0.6, -0.8]] as const).map((from) => ({ name: `knocked ${s} from ${from.join(',')}`, length: knockedLength(s), at: (t: number) => knocked(t, { from, strength: s }) })),
  ),
  { name: 'setDown', length: LENGTHS.setDown, at: (t) => setDown(t) },
  { name: 'dizzy', length: LENGTHS.dizzy, at: (t) => dizzy(t) },
  { name: 'salute', length: LENGTHS.salute, at: (t) => salute(t) },
  { name: 'outOfLane ahead', length: LENGTHS.outOfLane, at: (t) => outOfLane(t) },
  { name: 'outOfLane right', length: LENGTHS.outOfLane, at: (t) => outOfLane(t, { toward: [-1, 0.3] }) },
];

describe('fetch-porter performances (perform.ts)', () => {
  it('keeps every reaction within a second and a half (§ B5), a wallop longest', () => {
    expect(knockedLength('wallop')).toBeLessThanOrEqual(1.5);
    expect(knockedLength('nudge')).toBeLessThan(knockedLength('knock'));
    expect(knockedLength('knock')).toBeLessThan(knockedLength('wallop'));
    for (const v of Object.values(LENGTHS)) expect(v).toBeLessThanOrEqual(1.5);
    expect(KNOCK.nudge).toBeLessThan(KNOCK.wallop);
  });

  it('ends every finite beat on REST, with nothing left spun, slid or lifted', () => {
    for (const b of BEATS) {
      const end = b.at(b.length);
      expect(distance(end, REST), b.name).toBeLessThan(0.02);
      // and holds it after the end
      expect(distance(b.at(b.length + 0.5), end), b.name).toBeLessThan(1e-9);
    }
  });

  it('is pure: the same time and parameters give the same pose', () => {
    for (const b of BEATS) for (const t of [0, 0.13, 0.71]) expect(distance(b.at(t), b.at(t)), b.name).toBe(0);
    expect(distance(held(2.3, { carry: [1, 0, 2] }), held(2.3, { carry: [1, 0, 2] }))).toBe(0);
  });

  it('a knock shoves the body away from the hit and turns it; a wallop goes all the way round and leaves the bench', () => {
    const from: [number, number] = [-1, 0];
    const early = knocked(0.12, { from, strength: 'knock' });
    // the top goes toward +X (away from a hit from -X): lean side +, slide +X
    expect(early.slide![0]).toBeGreaterThan(0.02);
    let maxSpinNudge = 0, maxSpinWallop = 0, maxLift = 0;
    for (let t = 0; t <= 1.5; t += 0.01) {
      maxSpinNudge = Math.max(maxSpinNudge, Math.abs(knocked(t, { from, strength: 'nudge' }).spin!));
      const w = knocked(t, { from, strength: 'wallop' });
      maxSpinWallop = Math.max(maxSpinWallop, Math.abs(w.spin!));
      maxLift = Math.max(maxLift, w.lift!);
    }
    expect(maxSpinNudge).toBeLessThan(0.6);
    expect(maxSpinWallop).toBeGreaterThan(Math.PI * 2 - 0.01);
    expect(maxLift).toBeGreaterThan(0.03);
    // the wallop's turn is a whole one: it ends facing its lane again
    const end = knocked(knockedLength('wallop'), { from, strength: 'wallop' }).spin!;
    expect(Math.abs(Math.sin(end))).toBeLessThan(1e-6);
    expect(Math.cos(end)).toBeCloseTo(1, 6);
  });

  it('squeezes the eye shut after the hit and opens it again', () => {
    const wide = knocked(0.03, { from: [1, 0], strength: 'knock' });
    const shut = knocked(0.2, { from: [1, 0], strength: 'knock' });
    expect(wide.lids![0]).toBeLessThan(0.1);
    expect(shut.lids![0]).toBeGreaterThan(0.9);
    expect(knocked(knockedLength('knock'), { from: [1, 0], strength: 'knock' }).lids![0]).toBeLessThan(0.2);
  });

  it('keeps the hands outside the body in every frame of every beat', () => {
    const all = [...BEATS, { name: 'held', length: 4, at: (t: number) => held(t, { carry: [1.5, 0.5, -1] }) }, { name: 'handsUp', length: 2, at: (t: number) => handsUp(t) }];
    for (const b of all) {
      for (let t = 0; t <= b.length; t += 0.05) {
        const ms = poseMatrices(b.at(t));
        for (const s of ['L', 'R'] as const) {
          // (the hand rides the telescope's stages)
          const hand = new Vector3(0, -0.05, 0).applyMatrix4(inBody(ms, [`arm${s}`, `forearm${s}`, `tele${s}1`, `tele${s}2`, `tele${s}3`, `hand${s}`]));
          const inside = Math.abs(hand.x) < TORSO.w / 2 && hand.y > TORSO.y0 && hand.y < TORSO.lidTop && Math.abs(hand.z) < TORSO.d / 2;
          expect(inside, `${b.name} t=${t.toFixed(2)} ${s}`).toBe(false);
        }
      }
    }
  });

  it('held: the wheel runs down, the wheel swings under a torso that stays put, the eye goes from bench to visitor', () => {
    const w = (t: number): number => held(t).wheel!;
    expect(w(0.2) - w(0.1)).toBeGreaterThan(w(4.1) - w(4));
    // the torso does not move with the hang
    const body = (p: FetchPose): Matrix4 => inBody(poseMatrices(p), ['lean', 'body']);
    const swung = held(0.3, { carry: [2, 0, 1] });
    expect(Math.hypot(...swung.hang!)).toBeGreaterThan(0.1);
    const a = body({ ...swung, hang: [0, 0] }).elements, b = body(swung).elements;
    for (let i = 0; i < 16; i++) expect(b[i]).toBeCloseTo(a[i]!, 6);
    // ... while the tyre swings out from under it, trailing the hand (moving to +X: the tyre goes to -X)
    const tyre = (p: FetchPose): Vector3 => new Vector3().applyMatrix4(inBody(poseMatrices(p), ['lean', 'wheel']));
    expect(tyre(held(3, { carry: [3, 0, 0] })).x).toBeLessThan(tyre(held(3)).x - 0.02);
    // looks down first, up at the visitor later
    expect(held(0.6).headPitch!).toBeLessThan(-0.3);
    expect(held(1.9).headPitch!).toBeGreaterThan(0.3);
  });

  it('setDown starts from the hand and lands with the spring taking it', () => {
    let maxSquash = 0;
    for (let t = 0; t <= 0.3; t += 0.01) maxSquash = Math.max(maxSquash, setDown(t).squash!);
    expect(maxSquash).toBeGreaterThan(0.5);
  });

  it('salute raises the right claw to the peak; hands up raises both claws above the shoulders', () => {
    const ms = poseMatrices(salute(0.7));
    const r = new Vector3(0, -0.05, 0).applyMatrix4(inBody(ms, ['armR', 'forearmR', 'handR']));
    expect(r.y).toBeGreaterThan(TORSO.lidTop - 0.05);
    const up = poseMatrices(handsUp(1));
    for (const s of ['L', 'R'] as const) expect(new Vector3(0, -0.05, 0).applyMatrix4(inBody(up, [`arm${s}`, `forearm${s}`, `hand${s}`])).y).toBeGreaterThan(TORSO.y1);
  });

  it('blends poses at the ends exactly', () => {
    const a = knocked(0.2, { from: [1, 0], strength: 'wallop' }), b = salute(0.6);
    expect(distance(blendPose(a, b, 0), a)).toBeLessThan(1e-9);
    expect(distance(blendPose(a, b, 1), b)).toBeLessThan(1e-9);
  });

  it('ring and settle start where they say', () => {
    expect(ring(0, 2, 0.3)).toBe(0);
    expect(Math.max(...Array.from({ length: 200 }, (_, i) => ring(i / 400, 2, 0.3)))).toBeCloseTo(1, 2);
    expect(settle(0, 2, 0.3)).toBe(1);
  });

  it('the contact point follows a slide', () => {
    const [x, z] = contactPoint({ slide: [0.2, -0.1] });
    expect(x).toBeCloseTo(0.2, 6);
    expect(z).toBeCloseTo(-0.1, 6);
  });
});
