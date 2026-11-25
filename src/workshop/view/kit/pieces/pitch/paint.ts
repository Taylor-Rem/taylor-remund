/**
 * Paint on a realized Pitch (REWRITE.md § B2 X1, the PLATEN row: "a robot included"; P4 P1a): the cloth of his
 * envelope and his fins takes the paint; the chalk stripe, his collar, tie, moustache, hat, brass, lamps and
 * briefcase keep theirs. No rebuild: the cloth's vertex colours are rewritten in place (Fetch's way,
 * fetch-porter/paint.ts), each vertex keeping its own tone against the cloth it was built in.
 *
 * `paintPitch(object, { from, to, t, axis })` shows a change part way: the new paint up to an edge `t` of the way
 * along `axis` (piece space), the old beyond it; t = 0 all `from`, 1 all `to`; null is his own cloth.
 *
 * Which vertices are cloth is read from the geometry the first time: the felt of the nodes below whose colour is
 * dark (the cloth and its deeper roll; the stripe and the collar are light).
 */
import type { BufferAttribute, Mesh, Object3D } from 'three';
import { Vector3 } from 'three';
import { linear, type Token } from '../../../palette.ts';
import { sourcesOf } from '../../realize.ts';

/** The nodes whose felt is his suit (the envelope with its fins' roots, and the fins on the rudder). */
const CLOTH_NODES: ReadonlySet<string> = new Set(['float', 'rudder']);
/** Darker than this (the sum of a vertex's linear colour), a felt vertex is cloth: the stripe and the collar are far above it. */
const DARK = 0.45;
/** Paint on felt reads a little deeper than on enamel (it soaks in). */
const SOAK = 0.62;
const SOFT = 0.04;

interface Own {
  idx: Int32Array;
  pos: Float32Array;
  /** Each vertex's tone against the cloth's middle, and its own colour as built. */
  tone: Float32Array;
  bare: Float32Array;
}
const OWN = new WeakMap<Mesh, Own | null>();

function own(m: Mesh): Own | null {
  if (OWN.has(m)) return OWN.get(m)!;
  const col = m.geometry.getAttribute('color') as BufferAttribute | undefined;
  const pos = m.geometry.getAttribute('position') as BufferAttribute | undefined;
  if (!col || !pos || (m.material as { map?: unknown }).map) {
    OWN.set(m, null);
    return null;
  }
  const idx: number[] = [];
  for (const s of sourcesOf(m).filter((x) => CLOTH_NODES.has(x.node))) {
    for (let i = s.start; i < s.start + s.count; i++) {
      const sum = col.getX(i) + col.getY(i) + col.getZ(i);
      if (sum > 1e-5 && sum < DARK) idx.push(i);
    }
  }
  if (idx.length === 0) {
    OWN.set(m, null);
    return null;
  }
  let mid = 0;
  for (const i of idx) mid += col.getX(i) + col.getY(i) + col.getZ(i);
  mid /= idx.length;
  const o: Own = { idx: Int32Array.from(idx), pos: new Float32Array(idx.length * 3), tone: new Float32Array(idx.length), bare: new Float32Array(idx.length * 3) };
  idx.forEach((v, k) => {
    o.pos[k * 3] = pos.getX(v);
    o.pos[k * 3 + 1] = pos.getY(v);
    o.pos[k * 3 + 2] = pos.getZ(v);
    o.bare[k * 3] = col.getX(v);
    o.bare[k * 3 + 1] = col.getY(v);
    o.bare[k * 3 + 2] = col.getZ(v);
    o.tone[k] = (col.getX(v) + col.getY(v) + col.getZ(v)) / mid;
  });
  OWN.set(m, o);
  return o;
}

const ax = new Vector3();

/** Paint him: `from` beyond the edge, `to` up to it, `t` of the way along `axis` (piece space). Null: his own cloth. */
export function paintPitch(root: Object3D, o: { from: Token | null; to: Token | null; t: number; axis?: readonly [number, number, number] }): void {
  ax.set(...(o.axis ?? [0, -1, 0])).normalize();
  root.traverse((n) => {
    const m = n as Mesh;
    if (!m.isMesh) return;
    const w = own(m);
    if (!w) return;
    // the edge runs over the extent of his cloth along the axis
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < w.idx.length; k++) {
      const d = w.pos[k * 3]! * ax.x + w.pos[k * 3 + 1]! * ax.y + w.pos[k * 3 + 2]! * ax.z;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    const edge = lo + (hi - lo) * o.t;
    const col = m.geometry.getAttribute('color') as BufferAttribute;
    const A = o.from ? linear(o.from) : null;
    const Bc = o.to ? linear(o.to) : null;
    for (let k = 0; k < w.idx.length; k++) {
      const d = w.pos[k * 3]! * ax.x + w.pos[k * 3 + 1]! * ax.y + w.pos[k * 3 + 2]! * ax.z;
      const s = Math.min(1, Math.max(0, (edge - d) / SOFT + 0.5));
      const pick = (c: readonly number[] | null, j: number): number => (c ? c[j]! * SOAK * w.tone[k]! : w.bare[k * 3 + j]!);
      for (let j = 0; j < 3; j++) {
        const v = pick(A, j) * (1 - s) + pick(Bc, j) * s;
        if (j === 0) col.setX(w.idx[k]!, v);
        else if (j === 1) col.setY(w.idx[k]!, v);
        else col.setZ(w.idx[k]!, v);
      }
    }
    col.needsUpdate = true;
  });
}
