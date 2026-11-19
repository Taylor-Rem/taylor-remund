import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { catalogue, fetchPorter } from '../../../src/workshop/view/kit/pieces/fetch-porter/index.ts';
import { budget } from '../../../src/workshop/view/kit/compose.ts';
import {
  ARM_PRESETS, BEZEL_OPEN, EXPRESSIONS, EXPRESSION_NAMES, EYE, IRIS, LID, NEUTRAL, PRESETS, TORSO, poseFetch, poseMatrices,
} from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import type { FetchPose } from '../../../src/workshop/view/kit/pieces/fetch-porter/rig.ts';
import { checkGeometry } from './helpers.ts';

const RIG_NODES = [
  'root', 'lean', 'wheel', 'suspension', 'body', 'head', 'headCock', 'headTilt', 'brow', 'eye', 'pupil', 'pupilDot', 'lidTop', 'lidBottom',
  'armL', 'forearmL', 'teleL1', 'teleL2', 'teleL3', 'handL', 'pincerL0', 'pincerL1', 'armR', 'forearmR', 'teleR1', 'teleR2', 'teleR3', 'handR', 'pincerR0', 'pincerR1',
  'aerial', 'aerial2', 'aerial3', 'flag', 'flagTip',
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

/** World matrix of a node in body space, walking a path of node names from `body`. */
function inBody(ms: Record<string, Matrix4>, path: string[]): Matrix4 {
  const out = new Matrix4();
  for (const n of path) out.multiply(ms[n]!);
  return out;
}

describe('fetch-porter (Fetch, take B)', () => {
  const piece = fetchPorter({ seed: 3 });

  it('is deterministic for a seed and varies with it', () => {
    expect(hashPiece(fetchPorter({ seed: 3 }).root)).toBe(hashPiece(piece.root));
    expect(fetchPorter({ seed: 3 }).triangles).toBe(piece.triangles);
    expect(hashPiece(fetchPorter({ seed: 4 }).root)).not.toBe(hashPiece(piece.root));
  });

  it('has every rig node, each once', () => {
    const all = names(piece.root);
    for (const n of RIG_NODES) expect(all.filter((x) => x === n)).toHaveLength(1);
  });

  it('stays inside its triangle budget (9,600 with the telescope) and five meshes, and holds the kit invariants', () => {
    expect(piece.triangles).toBeLessThanOrEqual(9_600);
    const b = budget(fetchPorter({ seed: 3, nameTape: { key: 'fetch-tape', w: 0.16, h: 0.028 } }));
    expect(b.total).toBeLessThanOrEqual(9_600);
    expect(b.meshes).toBeLessThanOrEqual(5);
    expect(Object.keys(b.byMaterial).sort()).toEqual(['brass', 'bulb', 'rubber', 'steel', 'tape']);
    expect(fetchPorter({ detail: 'low' }).triangles).toBeLessThan(piece.triangles);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(piece.root);
  });

  it('is about a unit tall to its lid, with the turret and aerial above', () => {
    const ms = poseMatrices(NEUTRAL);
    const lid = new Vector3(0, TORSO.lidTop, 0).applyMatrix4(inBody(ms, ['root', 'lean', 'body']));
    expect(lid.y).toBeGreaterThan(0.7);
    expect(lid.y).toBeLessThan(0.85);
    expect(piece.size.y).toBeGreaterThan(1.1);
    expect(piece.size.y).toBeLessThan(1.45);
  });

  it('keeps the pupil inside the bezel at every gaze', () => {
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      for (const r of [0.5, 1, 3]) {
        const m = poseMatrices({ gaze: [Math.cos(a) * r, Math.sin(a) * r] }).pupil!;
        const axis = new Vector3(0, 0, 1).transformDirection(m);
        const off = Math.acos(Math.min(1, axis.z));
        // the iris's far edge stays inside the bezel's opening
        expect(off + IRIS.ang).toBeLessThan(BEZEL_OPEN);
      }
    }
  });

  it('closes its lids to meet at the middle without touching the lens', () => {
    // the lid shells ride outside the lens, the iris and the pupil
    expect(LID.r - LID.t / 2).toBeGreaterThan(EYE.rs + IRIS.lift + 0.004);
    const shut = poseMatrices({ lids: [1, 1] });
    const lipTop = new Vector3(0, 0, 1).transformDirection(shut.lidTop!);
    const lipBottom = new Vector3(0, 0, 1).transformDirection(shut.lidBottom!);
    // the top lip stays just above the middle, the bottom just below: they meet, they never cross
    expect(lipTop.y).toBeGreaterThan(0);
    expect(lipBottom.y).toBeLessThan(0);
    expect(lipTop.y - lipBottom.y).toBeLessThan(0.05);
    // and open, both are tucked out of the opening
    const open = poseMatrices({ lids: [0, 0] });
    expect(Math.asin(new Vector3(0, 0, 1).transformDirection(open.lidTop!).y)).toBeGreaterThan(BEZEL_OPEN);
  });

  it('keeps the hands outside the body in every arm preset and expression', () => {
    const poses: FetchPose[] = [...ARM_PRESETS.map((a) => ({ arms: a })), ...EXPRESSION_NAMES.map((n) => EXPRESSIONS[n])];
    for (const pose of poses) {
      const ms = poseMatrices(pose);
      for (const s of ['L', 'R'] as const) {
        const hand = new Vector3(0, -0.05, 0).applyMatrix4(inBody(ms, [`arm${s}`, `forearm${s}`, `hand${s}`]));
        const inside = Math.abs(hand.x) < TORSO.w / 2 && hand.y > TORSO.y0 && hand.y < TORSO.lidTop && Math.abs(hand.z) < TORSO.d / 2;
        expect(inside, `${JSON.stringify(pose.arms)} ${s}`).toBe(false);
      }
    }
  });

  it('gives each expression a distinct pose, and each differs from rest', () => {
    const flat = (p: FetchPose): number[] => Object.values(poseMatrices(p)).flatMap((m) => m.elements);
    const all = [NEUTRAL, ...EXPRESSION_NAMES.map((n) => EXPRESSIONS[n])].map(flat);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        let d = 0;
        for (let k = 0; k < all[i]!.length; k++) d += Math.abs(all[i]![k]! - all[j]![k]!);
        expect(d).toBeGreaterThan(1);
      }
  });

  it('blends arm presets by weight', () => {
    const half = poseMatrices({ arms: { rest: 1, offer: 1 } });
    expect(half.armL).toBeDefined();
    const a = PRESETS.rest.left.swing, b = PRESETS.offer.left.swing;
    const fromPose = poseMatrices({ arms: { left: { ...PRESETS.rest.left, swing: (a + b) / 2, abduct: (PRESETS.rest.left.abduct + PRESETS.offer.left.abduct) / 2, twist: (PRESETS.rest.left.twist + PRESETS.offer.left.twist) / 2 }, right: PRESETS.rest.right } });
    expect(half.armL!.equals(fromPose.armL!)).toBe(true);
  });

  it('poseFetch writes the same transforms into a realized node tree', () => {
    const top = new Group();
    const make = (n: PieceNode, parent: Object3D): void => {
      const g = new Group();
      g.name = n.name;
      parent.add(g);
      for (const c of n.children ?? []) make(c, g);
    };
    make(piece.root, top);
    poseFetch(top, EXPRESSIONS.oops);
    const ms = poseMatrices(EXPRESSIONS.oops);
    for (const n of RIG_NODES) {
      const o = top.getObjectByName(n)!;
      o.updateMatrix();
      const e = o.matrix.elements, f = ms[n]!.elements;
      for (let i = 0; i < 16; i++) expect(e[i]).toBeCloseTo(f[i]!, 5);
    }
  });

  it('builds posed through the catalogue without re-baking (cavity is the neutral bake)', () => {
    const e = catalogue[0]!;
    const posed = e.build({ seed: 3, pose: 'deadpan' });
    expect(posed.triangles).toBe(piece.triangles);
    expect(Object.keys(e.variants ?? {})).toEqual(expect.arrayContaining(EXPRESSION_NAMES));
  });
});
