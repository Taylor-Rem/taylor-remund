import { describe, expect, it } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { catalogue, patchFelt } from '../../../src/workshop/view/kit/pieces/patch-felt/index.ts';
import {
  ARM_PRESETS, EXPRESSIONS, EXPRESSION_NAMES, GAZE_MAX, HC, LID, NEUTRAL, PRESETS, eyeFrame, headRadius, posePatch, poseMatrices,
} from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import { pillow, smoothLoop, stitches, radialChart } from '../../../src/workshop/view/kit/pieces/patch-felt/felt.ts';
import { checkGeometry } from './helpers.ts';
import { budget } from '../../../src/workshop/view/kit/compose.ts';

const RIG_NODES = [
  'root', 'body', 'thighL', 'shinL', 'thighR', 'shinR', 'spine', 'head', 'headset', 'folder', 'folderLid', 'earL', 'earR', 'browL', 'browR', 'lidL', 'lidR', 'lidLowL', 'lidLowR', 'pupilL', 'pupilR', 'mouthL', 'mouthR', 'boom',
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

/** World matrix (root space) of a node path, from the neutral pose. */
function at(ms: Record<string, Matrix4>, path: string[]): Matrix4 {
  const out = new Matrix4();
  for (const n of path) out.multiply(ms[n] ?? new Matrix4());
  return out;
}

describe('patch-felt (Patch, take A: the felt puppet)', () => {
  const piece = patchFelt({ seed: 3, standIn: false });

  it('is deterministic for a seed and varies with it', () => {
    expect(hashPiece(patchFelt({ seed: 3, standIn: false }).root)).toBe(hashPiece(piece.root));
    expect(hashPiece(patchFelt({ seed: 4, standIn: false }).root)).not.toBe(hashPiece(piece.root));
  });

  it('has every rig node, each once', () => {
    const all = names(piece.root);
    for (const n of RIG_NODES) expect(all.filter((x) => x === n)).toHaveLength(1);
  });

  it('stays inside its budget (10,000 triangles and 5 meshes without the stand-in stool) and holds the kit invariants', () => {
    expect(piece.triangles).toBeLessThanOrEqual(10_000);
    expect(budget(piece).meshes).toBeLessThanOrEqual(5);
    expect(patchFelt({ detail: 'low', standIn: false }).triangles).toBeLessThan(piece.triangles);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(piece.root);
  });

  it('sits about 1.1 units tall on its seat (root at the seat top)', () => {
    // above the seat: head and ears; below: legs dangling over the edge
    expect(piece.size.y).toBeGreaterThan(1.1);
    expect(piece.size.y).toBeLessThan(1.5);
    const ms = poseMatrices(NEUTRAL);
    const hc = new Vector3(...HC).applyMatrix4(at(ms, ['spine', 'head']));
    expect(hc.y).toBeGreaterThan(0.65);
    expect(hc.y).toBeLessThan(0.85);
  });

  it('stands its stand-in stool on the bench at the seat height', () => {
    const p = patchFelt({ seed: 3 });
    expect(p.root.transform!.elements[13]).toBeCloseTo(0.6, 5);
    expect(p.triangles).toBeGreaterThan(piece.triangles);
  });

  it('keeps the bead on the eyeball and under the lid at every gaze', () => {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const m = poseMatrices({ gaze: [Math.cos(a) * 3, Math.sin(a) * 3] }).pupilL!;
      const F = eyeFrame(1);
      const local = F.clone().invert().multiply(m);
      const axis = new Vector3(0, 0, 1).transformDirection(local);
      expect(Math.acos(Math.min(1, axis.z))).toBeLessThanOrEqual(GAZE_MAX + 1e-6);
    }
  });

  it('sinks each eyeball into the head (it sits on the felt, not in front of it)', () => {
    for (const s of [1, -1] as const) {
      const c = new Vector3().setFromMatrixPosition(eyeFrame(s));
      const d = c.clone().sub(new Vector3(...HC));
      const r = headRadius(...(d.clone().normalize().toArray() as [number, number, number]));
      expect(d.length()).toBeLessThan(r);
    }
  });

  it('closes the upper lid monotonically from open to shut', () => {
    const elev = (v: number): number => {
      const m = new Matrix4().copy(eyeFrame(1)).invert().multiply(poseMatrices({ lids: [v, v] }).lidL!);
      const lip = new Vector3(0, 0, 1).transformDirection(m);
      return Math.atan2(lip.y, lip.z);
    };
    expect(elev(0)).toBeCloseTo(LID.open, 4);
    expect(elev(1)).toBeCloseTo(LID.closed, 4);
    expect(elev(0.5)).toBeLessThan(elev(0.3));
  });

  it('has the five named expressions, and each changes the face', () => {
    expect(EXPRESSION_NAMES).toEqual(['unimpressed', 'amused', 'the-look', 'working', 'checking']);
    const base = poseMatrices(NEUTRAL);
    for (const nm of EXPRESSION_NAMES) {
      const ms = poseMatrices(EXPRESSIONS[nm]);
      let moved = 0;
      for (const k of ['head', 'lidL', 'browL', 'mouthL', 'pupilL']) if (!ms[k]!.equals(base[k]!)) moved++;
      expect(moved).toBeGreaterThanOrEqual(3);
    }
    // the unimpressed rest is half-lidded, and its smirk is one-sided
    expect(EXPRESSIONS.unimpressed.lids[0]).toBeGreaterThan(0.3);
    expect(EXPRESSIONS.unimpressed.mouth[0]).toBeGreaterThan(EXPRESSIONS.unimpressed.mouth[1] + 0.3);
  });

  it('never waves: no preset lifts a paw above the head', () => {
    for (const k of ARM_PRESETS) {
      const ms = poseMatrices({ arms: k });
      for (const s of ['L', 'R']) {
        const paw = new Vector3().applyMatrix4(at(ms, ['body', 'spine', `arm${s}`, `forearm${s}`, `paw${s}`]));
        const hc = new Vector3(...HC).applyMatrix4(at(ms, ['body', 'spine', 'head']));
        expect(paw.y).toBeLessThan(hc.y);
      }
    }
    expect(Object.keys(PRESETS).sort()).toEqual([...ARM_PRESETS].sort());
  });

  it('poses a realized tree by node name', () => {
    const root = new Group();
    const mk = (n: PieceNode, parent: Object3D): void => {
      const g = new Group();
      g.name = n.name;
      parent.add(g);
      for (const c of n.children ?? []) mk(c, g);
    };
    mk(piece.root, root);
    posePatch(root, EXPRESSIONS['the-look']);
    const ms = poseMatrices(EXPRESSIONS['the-look']);
    const head = root.getObjectByName('head')!;
    head.updateMatrix();
    expect(head.matrix.equals(ms.head!) || head.matrix.elements.every((v, i) => Math.abs(v - ms.head!.elements[i]!) < 1e-6)).toBe(true);
  });

  it('builds every catalogue pose', () => {
    const e = catalogue.find((c) => c.name === 'patch-felt')!;
    expect(e.poses).toEqual(EXPRESSION_NAMES);
    for (const p of EXPRESSION_NAMES) expect(e.build({ pose: p, detail: 'low' }).triangles).toBeGreaterThan(0);
  });

  it('felt helpers: pillows and stitches are valid kit geometry', () => {
    const notched = smoothLoop([[-0.07, 0], [0.07, 0], [0.06, 0.08], [0.03, 0.09], [0.045, 0.11], [0, 0.16], [-0.06, 0.06]], 24);
    for (const g of pillow(notched, { t: 0.01, centre: [0, 0.06] })) checkGeometry(g);
    const s = stitches(radialChart(headRadius, HC, 0.18), notched, { kind: 'blanket' });
    expect(s).not.toBeNull();
    checkGeometry(s!);
  });
});
