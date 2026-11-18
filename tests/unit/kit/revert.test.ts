import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { CARD_LINES, catalogue, revert } from '../../../src/workshop/view/kit/pieces/revert/index.ts';
import {
  AXLE_Y, BODY_Y, CARD_CAP, CARD_ESTIMATE, EYE, EYE_C, FORE, GAZE_MAX, GRIP, HIDDEN, LAMP, LID, LOOP, NEUTRAL, POSES, POSE_NAMES, SHOULDER, SLOT, TRACK, UPPER,
  armReach, broomGrip, broomMatrix, cardMatrix, loopPoint, poseMatrices, poseRevert,
} from '../../../src/workshop/view/kit/pieces/revert/rig.ts';
import { budget } from '../../../src/workshop/view/kit/compose.ts';
import revertJson from '../../../src/content/revert.json';
import { checkGeometry } from './helpers.ts';

const SHOES = Array.from({ length: TRACK.n }, (_, i) => [`shoeL${i}`, `shoeR${i}`]).flat();
const RIG_NODES = [
  'root', 'chassis', 'wheelLF', 'wheelLB', 'wheelRF', 'wheelRB', ...SHOES, 'body', 'brow', 'eyeL', 'lampL', 'lidL', 'eyeR', 'lampR', 'lidR', 'crank', 'card', 'cardL',
  'arm', 'forearm', 'hand', 'jaw0', 'jaw1', 'broom',
];

function names(n: PieceNode, out: string[] = []): string[] {
  out.push(n.name);
  for (const c of n.children ?? []) names(c, out);
  return out;
}

function hashPiece(n: PieceNode): number {
  let h = 0;
  for (const q of n.parts) {
    const a = q.geometry.getAttribute('position').array;
    for (let i = 0; i < a.length; i += 7) h = (h * 31 + Math.round(a[i]! * 1e5)) | 0;
  }
  for (const c of n.children ?? []) h = (h * 17 + hashPiece(c)) | 0;
  return h;
}

describe('revert (Revert, the caretaker)', () => {
  const piece = revert({ seed: 3 });

  it('is deterministic for a seed and varies with it', () => {
    expect(hashPiece(revert({ seed: 3 }).root)).toBe(hashPiece(piece.root));
    expect(hashPiece(revert({ seed: 4 }).root)).not.toBe(hashPiece(piece.root));
  });

  it('has every rig node, each once', () => {
    const all = names(piece.root);
    for (const n of RIG_NODES) expect(all.filter((x) => x === n), n).toHaveLength(1);
  });

  it('stays inside its triangle cap (9,000) and holds the kit invariants', () => {
    const b = budget(piece, 9000);
    expect(b.fits, b.text).toBe(true);
    expect(revert({ detail: 'low' }).triangles).toBeLessThan(piece.triangles);
    // one skinned mesh per material class (and the card's texture): a moving piece's draw calls
    expect(b.meshes).toBeLessThanOrEqual(9);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(piece.root);
  });

  it('is low, wide and heavy at rest: about 0.9 tall to its deck furniture, 1.45 wide, 1.1 deep', () => {
    // the broom's head rides a little above the drum; the size is the rest pose's (card stowed)
    expect(piece.size.y).toBeGreaterThan(0.95);
    expect(piece.size.y).toBeLessThan(1.15);
    expect(piece.size.x).toBeGreaterThan(1.4);
    expect(piece.size.x).toBeLessThan(1.75);
    expect(piece.size.z).toBeGreaterThan(1.05);
    expect(piece.size.z).toBeLessThan(1.4);
    // wider than tall: the silhouette Fetch (taller than wide) can never be mistaken for
    expect(piece.size.x).toBeGreaterThan(piece.size.y * 1.3);
  });

  it('builds every named pose, and each one is different from the rest pose', () => {
    const flat = (m: Record<string, Matrix4>): number[] => Object.keys(m).sort().flatMap((k) => m[k]!.elements);
    const rest = flat(poseMatrices(NEUTRAL));
    for (const n of POSE_NAMES) {
      const p = flat(poseMatrices(POSES[n]));
      let d = 0;
      for (let k = 0; k < p.length; k++) d += Math.abs(p[k]! - rest[k]!);
      expect(d, n).toBeGreaterThan(0.2);
      expect(revert({ pose: n, detail: 'low' }).root).toBeDefined();
    }
  });

  it('runs its shoes round a closed loop: a full loop of travel is where it started, and the bottom run is on the bench', () => {
    for (const s of [0, 0.3, 1.1, 2.2]) {
      const a = loopPoint(s), b = loopPoint(s + LOOP);
      expect(Math.hypot(a.y - b.y, a.z - b.z)).toBeLessThan(1e-9);
    }
    // continuous: no jump anywhere round the loop
    for (let i = 0; i < 400; i++) {
      const a = loopPoint((i * LOOP) / 400), b = loopPoint(((i + 1) * LOOP) / 400);
      expect(Math.hypot(a.y - b.y, a.z - b.z)).toBeLessThan((LOOP / 400) * 1.01 + 1e-9);
    }
    const bottom = loopPoint(2 * TRACK.axleZ + Math.PI * (TRACK.rp + TRACK.shoeT / 2) + TRACK.axleZ);
    expect(bottom.y - TRACK.shoeT / 2).toBeCloseTo(0, 6);
    expect(AXLE_Y).toBeCloseTo(TRACK.rp + TRACK.shoeT, 9);
    // travelling moves every shoe: the treads show motion
    const a = poseMatrices({ travel: 0 }), b = poseMatrices({ travel: 0.05 });
    expect(a.shoeL3!.equals(b.shoeL3!)).toBe(false);
    expect(a.wheelRF!.equals(b.wheelRF!)).toBe(false);
  });

  it('keeps the lamp inside the bezel at every gaze, and its lids cover the lens shut and clear it open', () => {
    const open = Math.asin(EYE.a / EYE.rs);
    expect(GAZE_MAX).toBeGreaterThan(0.05);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const m = poseMatrices({ gaze: [Math.cos(a) * 3, Math.sin(a) * 3] }).lampL!;
      const axis = new Vector3(0, 0, 1).transformDirection(m);
      expect(Math.acos(Math.min(1, axis.z)) + LAMP.ang).toBeLessThan(open);
    }
    expect(LID.r - LID.t / 2).toBeGreaterThan(EYE.rs + LAMP.lift + 0.004);
    const lip = (l: number): number => Math.asin(new Vector3(0, 0, 1).transformDirection(poseMatrices({ lids: [l, l] }).lidL!).y);
    expect(lip(0)).toBeGreaterThan(open);
    expect(lip(1)).toBeLessThan(-open);
    // a lamp switched off is shrunk into itself, never hidden (drawing is skinned)
    const off = poseMatrices({ lamps: [false, true] });
    expect(new Vector3().setFromMatrixScale(off.lampL!).x).toBeCloseTo(HIDDEN, 9);
    expect(new Vector3().setFromMatrixScale(off.lampR!).x).toBeCloseTo(1, 9);
    expect(EYE_C).toBeLessThan(0);
  });

  it('feeds its card out of the deck slot: hidden when stowed, up and leaning to the visitor when shown, folded to fit the slot on the way', () => {
    const stowed = cardMatrix(0, 0, 0, CARD_ESTIMATE.w);
    expect(new Vector3().setFromMatrixScale(stowed).x).toBeCloseTo(HIDDEN, 9);
    const up = cardMatrix(1, 1, 0, CARD_ESTIMATE.w);
    const clip = new Vector3(0, 0.1, 0).applyMatrix4(up);
    expect(clip.y + BODY_Y).toBeGreaterThan(SLOT.y);
    // it leans back toward a camera above the bench: its face normal points up as well as out
    const n = new Vector3(0, 0, 1).transformDirection(up);
    expect(n.y).toBeGreaterThan(0.2);
    expect(n.z).toBeGreaterThan(0.8);
    // folded, the left leaf lies behind the right one; open, it lies beside it
    expect(new Vector3(-1, 0, 0).transformDirection(poseMatrices({ card: { lift: 1, open: 0 } }).cardL!).x).toBeCloseTo(1, 6);
    expect(new Vector3(-1, 0, 0).transformDirection(poseMatrices({ card: { lift: 1, open: 1 } }).cardL!).x).toBeCloseTo(-1, 6);
    // the longest card, folded, fits the slot (1.12 long); its capitals pass 12 px at the whole-bench view (~56 px a unit)
    expect(CARD_ESTIMATE.w / 2).toBeLessThan(1.1);
    expect(CARD_CAP * 56).toBeGreaterThanOrEqual(12);
  });

  it('reaches the broom with its one arm, stowed and out', () => {
    for (const k of [0, 1]) {
      const bm = broomMatrix(k, 0);
      const grip = new Vector3(0, broomGrip(k), 0).applyMatrix4(bm).sub(new Vector3(SHOULDER.x, SHOULDER.y - BODY_Y, SHOULDER.z));
      const j = armReach(grip.clone());
      // forward kinematics of the solved joints puts the grip centre on the handle
      const m = new Matrix4().makeRotationY(j.yaw).multiply(new Matrix4().makeRotationX(-j.swing));
      const elbow = new Vector3(0, -UPPER, 0).applyMatrix4(m);
      const fm = m.clone().multiply(new Matrix4().makeRotationX(-j.elbow));
      const tip = elbow.clone().add(new Vector3(0, -(FORE + GRIP), 0).transformDirection(fm).multiplyScalar(FORE + GRIP));
      expect(tip.distanceTo(grip), `broom ${k}`).toBeLessThan(0.03);
    }
    // out, the broom's head is on the bench in front of the treads
    const head = new Vector3(0, 0, 0).applyMatrix4(broomMatrix(1, 0));
    expect(head.y + BODY_Y).toBeCloseTo(0, 1);
    expect(head.z).toBeGreaterThan(TRACK.axleZ + 0.2);
  });

  it('says the four lines of the spec, verbatim, each with its source', () => {
    expect(CARD_LINES.rung1).toBe('WELL, THAT WAS UNNECESSARY.');
    expect(CARD_LINES.rung2).toBe('AGAIN.');
    expect(CARD_LINES.rung3).toBe('IT SAYS DO NOT.');
    expect(CARD_LINES.rung4).toBe('I JUST CLEANED THAT.');
    for (const e of Object.values(revertJson.cards)) expect(e.source).toMatch(/REWRITE\.md § B4/);
  });

  it('poseRevert writes the same transforms into a realized node tree', () => {
    const top = new Group();
    const make = (n: PieceNode, parent: Object3D): void => {
      const g = new Group();
      g.name = n.name;
      parent.add(g);
      for (const c of n.children ?? []) make(c, g);
    };
    make(piece.root, top);
    poseRevert(top, POSES.sweep);
    const ms = poseMatrices(POSES.sweep);
    for (const name of ['body', 'brow', 'lidL', 'crank', 'broom', 'hand', 'shoeR7']) {
      const o = top.getObjectByName(name)!;
      const m = new Matrix4().compose(o.position, o.quaternion, o.scale);
      for (let k = 0; k < 16; k++) expect(m.elements[k]!).toBeCloseTo(ms[name]!.elements[k]!, 5);
    }
  });

  it('is registered in the catalogue with its poses', () => {
    const e = catalogue.find((c) => c.name === 'revert')!;
    expect(e).toBeDefined();
    expect(e.poses).toEqual(POSE_NAMES);
    for (const p of ['idle', 'trundle', 'sweep', 'crank', 'card-up', 'limp', 'asleep']) expect(POSE_NAMES).toContain(p);
  });
});
