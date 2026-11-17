import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D, Vector3 } from 'three';
import {
  ARM_PRESETS, DIM, EXPRESSIONS, GAZE_MAX, NODE_NAMES, buildFetchBulb, catalogue, eyeDims, poseFetch, poseMatrices, poseWorld, resolvePose,
} from '../../../src/workshop/view/kit/pieces/fetch-bulb/index.ts';
import type { ArmPreset, Expression } from '../../../src/workshop/view/kit/pieces/fetch-bulb/index.ts';
import { bulbR } from '../../../src/workshop/view/kit/pieces/fetch-bulb/build.ts';
import { countTriangles } from '../../../src/workshop/view/kit/compose.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { checkGeometry } from './helpers.ts';

const names = (n: PieceNode, out: string[] = []): string[] => {
  out.push(n.name);
  for (const c of n.children ?? []) names(c, out);
  return out;
};
const allParts = (n: PieceNode): PieceNode['parts'] => [...n.parts, ...(n.children ?? []).flatMap(allParts)];

/** Is a root-space point inside the bulb (head space, with a small margin)? */
function insideBulb(W: Record<string, Matrix4>, p: Vector3, margin = 0): boolean {
  const q = p.clone().applyMatrix4(W.head!.clone().invert());
  if (q.y < DIM.bulb.neckY - 0.06 || q.y > DIM.bulb.top) return false;
  const r = q.y < DIM.bulb.neckY ? DIM.bulb.neckR + 0.07 : bulbR(q.y); // below the neck: the yoke
  return Math.hypot(q.x, q.z) < r + margin;
}

/** The points along an arm worth keeping clear: elbow, wrist, the jaw tips. */
function armPoints(W: Record<string, Matrix4>, side: 'L' | 'R'): Vector3[] {
  const at = (n: string, x = 0, y = 0, z = 0): Vector3 => new Vector3(x, y, z).applyMatrix4(W[n]!);
  return [at(`forearm${side}`), at(`hand${side}`), at(`pincer${side}a`, 0, -0.09, 0.012), at(`pincer${side}b`, 0, -0.09, -0.012)];
}

describe('fetch-bulb', () => {
  const piece = buildFetchBulb({ seed: 1 });

  it('is deterministic', () => {
    const a = buildFetchBulb({ seed: 7 }), b = buildFetchBulb({ seed: 7 });
    expect(a.triangles).toBe(b.triangles);
    const pa = allParts(a.root), pb = allParts(b.root);
    expect(pa.length).toBe(pb.length);
    for (let i = 0; i < pa.length; i++) {
      expect(Array.from(pa[i]!.geometry.getAttribute('position').array)).toEqual(Array.from(pb[i]!.geometry.getAttribute('position').array));
      expect(Array.from(pa[i]!.geometry.getAttribute('color').array)).toEqual(Array.from(pb[i]!.geometry.getAttribute('color').array));
    }
  });

  it('has every named node of the rig, once', () => {
    const n = names(piece.root);
    for (const k of NODE_NAMES) expect(n.filter((x) => x === k)).toHaveLength(1);
  });

  it('stays inside the triangle budget, and its geometry is sound', () => {
    expect(piece.triangles).toBe(countTriangles(piece));
    expect(piece.triangles).toBeLessThanOrEqual(14000);
    expect(buildFetchBulb({ detail: 'low' }).triangles).toBeLessThan(piece.triangles * 0.75);
    for (const p of allParts(piece.root)) checkGeometry(p.geometry);
  });

  it('is about a unit tall to the top of its body and stands on the bench', () => {
    expect(DIM.headY + DIM.bulb.top).toBeGreaterThan(0.95);
    expect(DIM.headY + DIM.bulb.top).toBeLessThan(1.1);
    const W = poseWorld({});
    const contact = new Vector3(0, -DIM.tyreR, 0).applyMatrix4(W.lean!);
    expect(Math.abs(contact.y)).toBeLessThan(0.02);
  });

  it('keeps the pupil on the lens and inside the bezel at any gaze', () => {
    const e = eyeDims();
    const aI = Math.asin(e.irisR / e.R);
    for (const g of [[1, 0], [0, 1], [-1, -1], [3, 3], [0.7, -0.7]] as const) {
      const M = poseMatrices({ gaze: [g[0], g[1]] }).pupil;
      // the pupil's axis, in eye space (the pupil turns about the lens centre)
      const axis = new Vector3(0, 0, 1).applyMatrix4(new Matrix4().extractRotation(M));
      const off = Math.acos(Math.min(1, axis.z));
      expect(off).toBeLessThanOrEqual(GAZE_MAX + 1e-6);
      expect(off + aI).toBeLessThan(e.cap); // the whole iris stays on the lens
      expect(Math.atan2(e.R * Math.sin(off + aI), e.R * Math.cos(off + aI))).toBeLessThan(Math.atan2(e.boreR + 0.012, e.zFront)); // and inside the bezel's bore
    }
  });

  it('closes the lids to meet without touching the lens', () => {
    const e = eyeDims();
    expect(e.lidBotR - 0.004).toBeGreaterThan(e.R + 0.001); // both shells ride outside the lens
    expect(e.lidTopR - 0.004).toBeGreaterThan(e.lidBotR); // and the top passes over the bottom
    const M = poseMatrices({ lids: [1, 1] });
    const edge = (m: Matrix4, el: number): number => {
      const v = new Vector3(0, Math.sin(el), Math.cos(el)).applyMatrix4(new Matrix4().extractRotation(m));
      return Math.atan2(v.y, v.z);
    };
    const top = edge(M.lidTop, -1.2 * Math.PI / 180), bot = edge(M.lidBottom, 1.2 * Math.PI / 180);
    expect(top).toBeLessThan(bot); // they overlap a little: no gap in a blink
    // open, each edge is out of sight behind the bezel
    const O = poseMatrices({ lids: [0, 0] });
    const sight = Math.atan2(e.boreR, e.zb);
    expect(edge(O.lidTop, -1.2 * Math.PI / 180)).toBeGreaterThan(sight - 0.12);
    expect(edge(O.lidBottom, 1.2 * Math.PI / 180)).toBeLessThan(-(sight - 0.12));
  });

  it('keeps the hands outside the body in every arm preset and expression', () => {
    const poses = [...(Object.keys(ARM_PRESETS) as ArmPreset[]).map((a) => ({ arms: a })), ...Object.values(EXPRESSIONS)];
    for (const p of poses) {
      const W = poseWorld(p);
      for (const s of ['L', 'R'] as const) for (const pt of armPoints(W, s)) expect(insideBulb(W, pt), `${JSON.stringify(p.arms)} ${s}`).toBe(false);
    }
  });

  it('gives every expression a distinct pose', () => {
    const keys = Object.keys(EXPRESSIONS) as Expression[];
    expect(keys.sort()).toEqual(['curious', 'deadpan', 'eager', 'offer', 'oops']);
    const sig = (e: Expression): number[] => {
      const M = poseMatrices(EXPRESSIONS[e]);
      return NODE_NAMES.flatMap((n) => Array.from(M[n].elements));
    };
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const a = sig(keys[i]!), b = sig(keys[j]!);
        const d = Math.max(...a.map((v, k) => Math.abs(v - b[k]!)));
        expect(d, `${keys[i]} vs ${keys[j]}`).toBeGreaterThan(0.05);
      }
  });

  it('poses a realised tree and a Piece the same way', () => {
    const root = new Object3D();
    const nodes: Record<string, Object3D> = {};
    for (const n of NODE_NAMES) {
      const o = new Object3D();
      o.name = n;
      nodes[n] = o;
      root.add(o);
    }
    poseFetch(root, EXPRESSIONS.oops);
    const M = poseMatrices(EXPRESSIONS.oops);
    nodes.head!.updateMatrix();
    for (let k = 0; k < 16; k++) expect(nodes.head!.matrix.elements[k]).toBeCloseTo(M.head.elements[k]!, 6);
    const p: Piece = buildFetchBulb({ detail: 'low' });
    poseFetch(p, EXPRESSIONS.oops);
    const find = (n: PieceNode, name: string): PieceNode | undefined => (n.name === name ? n : (n.children ?? []).map((c) => find(c, name)).find(Boolean));
    expect(find(p.root, 'pupil')!.transform!.equals(M.pupil)).toBe(true);
  });

  it('clamps out-of-range poses', () => {
    const p = resolvePose({ gaze: [5, 0], lids: [2, -1], squash: 3 });
    expect(Math.hypot(...p.gaze)).toBeCloseTo(1, 6);
    expect(p.lids).toEqual([1, 0]);
    expect(p.squash).toBe(1);
  });

  it('registers in the catalogue with the expressions as variants', () => {
    const e = catalogue[0]!;
    expect(e.name).toBe('fetch-bulb');
    for (const k of Object.keys(EXPRESSIONS)) expect(e.variants?.[k]).toEqual({ pose: k });
    const posed = e.build({ detail: 'low', pose: 'deadpan' });
    expect(posed.triangles).toBeGreaterThan(0);
  });
});
