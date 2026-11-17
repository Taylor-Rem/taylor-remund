import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Object3D, Vector3 } from 'three';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { applyPose, catalogue, patchToy } from '../../../src/workshop/view/kit/pieces/patch-toy/index.ts';
import {
  ARM_PRESETS, EXPRESSIONS, EXPRESSION_NAMES, GAZE_MAX, NEUTRAL, PRESETS, lidAngle, posePatch, poseMatrices,
} from '../../../src/workshop/view/kit/pieces/patch-toy/rig.ts';
import type { PatchPose } from '../../../src/workshop/view/kit/pieces/patch-toy/rig.ts';
import { checkGeometry } from './helpers.ts';

const RIG_NODES = [
  'root', 'spine', 'head', 'earL', 'earR', 'browL', 'browR', 'eyeL', 'eyeR', 'lidL', 'lidR', 'pupilL', 'pupilR', 'boom',
  'armL', 'forearmL', 'pawL', 'armR', 'forearmR', 'pawR', 'tail', 'tail2', 'tail3', 'tail4',
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

/** World matrix along a path of node names, from the root. */
function along(ms: Record<string, Matrix4>, path: string[]): Matrix4 {
  const out = new Matrix4();
  for (const n of path) out.multiply(ms[n]!);
  return out;
}

describe('patch-toy (Patch, the enamel figurine)', () => {
  const piece = patchToy({ seed: 3 });

  it('is deterministic for a seed', () => {
    expect(hashPiece(patchToy({ seed: 3 }).root)).toBe(hashPiece(piece.root));
    expect(patchToy({ seed: 3 }).triangles).toBe(piece.triangles);
  });

  it('has every rig node, each once', () => {
    const all = names(piece.root);
    for (const n of RIG_NODES) expect(all.filter((x) => x === n)).toHaveLength(1);
  });

  it('stays inside its triangle budget (16,000) and holds the kit invariants', () => {
    expect(piece.triangles).toBeLessThanOrEqual(16_000);
    expect(patchToy({ detail: 'low' }).triangles).toBeLessThan(piece.triangles * 0.8);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(piece.root);
  });

  it('is about 1.1 units tall seated (seat to ear tips)', () => {
    expect(piece.size.y).toBeGreaterThan(1.0);
    expect(piece.size.y).toBeLessThan(1.5);
    const ms = poseMatrices(NEUTRAL);
    const crown = new Vector3(0, 0.375, 0).applyMatrix4(along(ms, ['root', 'spine', 'head']));
    expect(crown.y).toBeGreaterThan(0.8);
    expect(crown.y).toBeLessThan(0.95);
  });

  it('half-lidded is the rest: a lid of 0.5 sits between open and closed, and the lids close past the eye centre', () => {
    expect(lidAngle(0)).toBeGreaterThan(1);
    expect(lidAngle(1)).toBeLessThan(-0.3);
    expect(Math.abs(lidAngle(0.5))).toBeLessThan(0.5);
    expect(NEUTRAL.lids).toEqual([0.5, 0.5]);
  });

  it('turns the pupils the way the gaze says, no further than GAZE_MAX', () => {
    const dir = (pose: PatchPose, s: 'L' | 'R'): Vector3 => {
      const ms = poseMatrices(pose);
      return new Vector3(0, 0, 1).transformDirection(ms[`eye${s}`]!.clone().multiply(ms[`pupil${s}`]!));
    };
    for (const s of ['L', 'R'] as const) {
      const ahead = dir({ gaze: [0, 0] }, s);
      expect(ahead.z).toBeGreaterThan(0.97);
      const right = dir({ gaze: [1, 0] }, s);
      expect(right.x).toBeGreaterThan(0.45);
      expect(Math.acos(Math.min(1, right.dot(ahead)))).toBeLessThanOrEqual(GAZE_MAX + 1e-6);
      expect(dir({ gaze: [0, 1] }, s).y).toBeGreaterThan(0.3);
      expect(dir({ gaze: [0, -1] }, s).y).toBeLessThan(-0.3);
    }
  });

  it('every expression and arm preset produces finite transforms, and the expressions differ', () => {
    const seen = new Set<string>();
    for (const n of EXPRESSION_NAMES) {
      const ms = poseMatrices(EXPRESSIONS[n]);
      for (const m of Object.values(ms)) for (const v of m.elements) expect(Number.isFinite(v)).toBe(true);
      seen.add(JSON.stringify(EXPRESSIONS[n]));
    }
    expect(seen.size).toBe(EXPRESSION_NAMES.length);
    for (const a of ARM_PRESETS) expect(PRESETS[a].left.swing).toBeTypeOf('number');
    expect(EXPRESSION_NAMES).toEqual(expect.arrayContaining(['unimpressed', 'amused', 'the-look', 'working', 'checking']));
  });

  it('the look slides the pupils hard toward the visitor side while the head stays turned less than the default', () => {
    expect(EXPRESSIONS['the-look'].gaze[0]).toBe(1);
    expect(EXPRESSIONS['the-look'].headYaw).toBeLessThan(EXPRESSIONS.unimpressed.headYaw);
  });

  it('posePatch writes node transforms on a realized tree', () => {
    const root = new Group();
    const head = new Object3D();
    head.name = 'head';
    const lid = new Object3D();
    lid.name = 'lidL';
    root.add(head, lid);
    posePatch(root, { headYaw: 0.5, lids: [1, 0] });
    expect(head.quaternion.y).not.toBe(0);
    const expected = poseMatrices({ headYaw: 0.5, lids: [1, 0] }).lidL!;
    const q = lid.quaternion.clone();
    const e = new Matrix4().makeRotationFromQuaternion(q);
    expect(e.elements[5]).toBeCloseTo(expected.elements[5]!, 5);
  });

  it('builds posed through the catalogue entry, the pose only moving nodes', () => {
    const entry = catalogue.find((e) => e.name === 'patch-toy')!;
    expect(entry.poses).toEqual(EXPRESSION_NAMES);
    const posed = entry.build({ pose: 'amused', seed: 3 });
    expect(posed.triangles).toBe(piece.triangles);
    const p2 = applyPose(patchToy({ seed: 3 }), EXPRESSIONS.amused);
    const head = (n: PieceNode): PieceNode | undefined => (n.name === 'head' ? n : (n.children ?? []).map(head).find(Boolean));
    expect(head(p2.root)!.transform!.elements).toEqual(poseMatrices(EXPRESSIONS.amused).head!.elements);
  });
});
