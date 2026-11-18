import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import {
  DOOR, HATCH_POSES, HATCH_POSE_NAMES, LIFT, OPENING, catalogue, hatchMatrices, liftHeight, poseHatch, revertHatch,
} from '../../../src/workshop/view/kit/pieces/revert-hatch/index.ts';
import { revert } from '../../../src/workshop/view/kit/pieces/revert/index.ts';
import { budget } from '../../../src/workshop/view/kit/compose.ts';
import { checkGeometry } from './helpers.ts';

function names(n: PieceNode, out: string[] = []): string[] {
  out.push(n.name);
  for (const c of n.children ?? []) names(c, out);
  return out;
}

describe('revert-hatch (the hatch and lift Revert comes up through)', () => {
  const piece = revertHatch({ seed: 2 });

  it('has its doors and lift as nodes, each once, and fits its cap (2,500)', () => {
    const all = names(piece.root);
    for (const n of ['doorL', 'doorR', 'lift']) expect(all.filter((x) => x === n)).toHaveLength(1);
    const b = budget(piece, 2500);
    expect(b.fits, b.text).toBe(true);
    expect(b.meshes, b.text).toBeLessThanOrEqual(3);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(piece.root);
  });

  it('shut, stands a little proud of the bench (a trapdoor, not a decal); open, its doors stand up past upright', () => {
    expect(DOOR.top).toBeGreaterThan(0.02);
    const far = (m: Matrix4, s: number): Vector3 => {
      // the leaf's far edge, in node space: the hinge axis is local +Y (world Z), the leaf runs inward along local ±X
      return new Vector3(-s * (OPENING.w / 2), 0, 0).applyMatrix4(m);
    };
    const shut = hatchMatrices(HATCH_POSES.shut);
    expect(far(shut.doorL!, -1).y).toBeCloseTo(DOOR.top - DOOR.t / 2, 6);
    const open = hatchMatrices(HATCH_POSES.open);
    const l = far(open.doorL!, -1), r = far(open.doorR!, 1);
    expect(l.y).toBeGreaterThan(0.7);
    expect(r.y).toBeGreaterThan(0.7);
    // past upright: they lean out, away from the opening, and clear it
    expect(l.x).toBeLessThan(-OPENING.w / 2);
    expect(r.x).toBeGreaterThan(OPENING.w / 2);
  });

  it('lifts flush with the bench, and Revert fits under the shut doors', () => {
    expect(liftHeight(1)).toBeCloseTo(0, 9);
    expect(liftHeight(0)).toBeCloseTo(-LIFT.depth, 9);
    const r = revert({ detail: 'low' });
    expect(r.size.y).toBeLessThan(LIFT.depth - 0.05);
    expect(r.size.x).toBeLessThan(OPENING.w);
    expect(r.size.z).toBeLessThan(OPENING.d);
  });

  it('poses: every named pose builds, and poseHatch writes the same transforms', () => {
    for (const n of HATCH_POSE_NAMES) expect(revertHatch({ pose: n, detail: 'low' }).root).toBeDefined();
    const top = new Group();
    const make = (n: PieceNode, parent: Object3D): void => {
      const g = new Group();
      g.name = n.name;
      parent.add(g);
      for (const c of n.children ?? []) make(c, g);
    };
    make(piece.root, top);
    poseHatch(top, HATCH_POSES.opening);
    const ms = hatchMatrices(HATCH_POSES.opening);
    for (const name of ['doorL', 'doorR', 'lift']) {
      const o = top.getObjectByName(name)!;
      const m = new Matrix4().compose(o.position, o.quaternion, o.scale);
      for (let k = 0; k < 16; k++) expect(m.elements[k]!).toBeCloseTo(ms[name]!.elements[k]!, 5);
    }
    expect(catalogue[0]!.name).toBe('revert-hatch');
  });
});
