/**
 * Paint on a realized Fetch (REWRITE.md § B1 "colour": the platen paints a
 * robot too; brief W5): its cream enamel (the pail and its lid, the turret's
 * can, the eyelids) takes the paint, the teal trim, brass, rubber and glass
 * keep theirs. No rebuild: the enamel's vertex colours are rewritten in place
 * (the crate's and the storefront's way), each vertex keeping its own
 * seeded unevenness (its tone against the cream it was built in).
 *
 * `paintPorter(object, { from, to, t, axis })` shows a change part way: the
 * new paint up to an edge `t` of the way along `axis` (piece space), the old
 * beyond it, the edge a little uneven; t = 0 all `from`, 1 all `to`. The
 * enamel is finely tessellated, so the edge is drawn by its vertex colours.
 *
 * Which vertices are enamel is read from the geometry itself the first time
 * (vertex colours of the cream's hue in the painted-steel meshes of the
 * nodes named below), so the piece's builder needs nothing for it.
 */
import type { BufferAttribute, Mesh, Object3D } from 'three';
import { Vector3 } from 'three';
import { linear, type Token } from '../../../palette.ts';
import { sourcesOf } from '../../realize.ts';

/** The nodes whose cream enamel is paint (the torso, the turret's can, the eyelids). */
const PAINTED_NODES: ReadonlySet<string> = new Set(['body', 'headTilt', 'lidTop', 'lidBottom']);
/** The cream it was built in, and how near a vertex's hue must be to it to count as enamel. */
const CREAM: Token = 'paper';
const HUE_TOL = 0.025;
/** The edge's softness and unevenness (units, piece space; Fetch is drawn 1.5× on the bench). */
const SOFT = 0.03;
const RAG = 0.018;

interface Own {
  /** Enamel vertices (mesh indices), their rest positions (mesh = piece space) and tones; the bare colours. */
  idx: Int32Array;
  pos: Float32Array;
  tone: Float32Array;
  bare: Float32Array;
}
const OWN = new WeakMap<Mesh, Own | null>();

function own(m: Mesh): Own | null {
  if (OWN.has(m)) return OWN.get(m)!;
  const col = m.geometry.getAttribute('color') as BufferAttribute | undefined;
  if (!col || (m.material as { map?: unknown }).map) {
    OWN.set(m, null);
    return null;
  }
  const [cr, cg, cb] = linear(CREAM);
  const cs = cr + cg + cb;
  const idx: number[] = [];
  const sources = sourcesOf(m).filter((s) => PAINTED_NODES.has(s.node));
  for (const s of sources) {
    for (let i = s.start; i < s.start + s.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      const sum = r + g + b;
      if (sum < 1e-4) continue;
      if (Math.abs(r / sum - cr / cs) < HUE_TOL && Math.abs(g / sum - cg / cs) < HUE_TOL && Math.abs(b / sum - cb / cs) < HUE_TOL) idx.push(i);
    }
  }
  if (idx.length === 0) {
    OWN.set(m, null);
    return null;
  }
  // this object's own copy (the skinned geometry is shared per Piece)
  const g = m.geometry.clone();
  g.userData = { ...m.geometry.userData };
  m.geometry = g;
  const pos = g.getAttribute('position') as BufferAttribute;
  const c2 = g.getAttribute('color') as BufferAttribute;
  const o: Own = { idx: new Int32Array(idx), pos: new Float32Array(idx.length * 3), tone: new Float32Array(idx.length), bare: new Float32Array(idx.length * 3) };
  idx.forEach((i, k) => {
    o.pos.set([pos.getX(i), pos.getY(i), pos.getZ(i)], k * 3);
    o.bare.set([c2.getX(i), c2.getY(i), c2.getZ(i)], k * 3);
    o.tone[k] = (c2.getX(i) + c2.getY(i) + c2.getZ(i)) / cs;
  });
  OWN.set(m, o);
  return o;
}

export interface PorterLook {
  from: Token | null;
  to: Token | null;
  t: number;
  axis?: readonly [number, number, number];
  seed?: number;
}

const vA = new Vector3();

/** Draw Fetch's enamel part way through a change of paint (see the file note). Returns the vertices written (0: not Fetch). */
export function paintPorter(object: Object3D, look: PorterLook): number {
  const list: Array<{ m: Mesh; o: Own }> = [];
  object.traverse((x) => {
    const m = x as Mesh;
    if (!m.isMesh || (m.userData['kitProxy'] as boolean | undefined)) return;
    const o = own(m);
    if (o) list.push({ m, o });
  });
  if (list.length === 0) return 0;
  const t = Math.max(0, Math.min(1, look.t));
  const ax = look.axis ?? [0, -0.83, 0.56];
  vA.set(ax[0], ax[1], ax[2]).normalize();
  const s = ((look.seed ?? 1) % 997) * 0.731;
  let lo = Infinity, hi = -Infinity;
  for (const { o } of list) for (let k = 0; k < o.tone.length; k++) {
    const d = o.pos[k * 3]! * vA.x + o.pos[k * 3 + 1]! * vA.y + o.pos[k * 3 + 2]! * vA.z;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const edge = lo - (SOFT + RAG) + (hi - lo + 2 * (SOFT + RAG)) * t;
  const a = look.from ? linear(look.from) : null;
  const b = look.to ? linear(look.to) : null;
  let n = 0;
  for (const { m, o } of list) {
    const col = m.geometry.getAttribute('color') as BufferAttribute;
    for (let k = 0; k < o.tone.length; k++) {
      const x = o.pos[k * 3]!, y = o.pos[k * 3 + 1]!, z = o.pos[k * 3 + 2]!;
      const rag = RAG * (0.5 * Math.sin(x * 41 + y * 7 + s) + 0.3 * Math.sin(y * 29 + z * 37 + s * 1.7) + 0.2 * Math.sin((x - z) * 97 + s * 2.3));
      // w: how much of the new paint (1 on the near side of the edge)
      const w = t >= 1 ? 1 : t <= 0 ? 0 : Math.max(0, Math.min(1, (edge - rag - (x * vA.x + y * vA.y + z * vA.z)) / SOFT + 0.5));
      const tone = o.tone[k]!;
      for (let c = 0; c < 3; c++) {
        const from = a ? a[c]! * tone : o.bare[k * 3 + c]!;
        const to = b ? b[c]! * tone : o.bare[k * 3 + c]!;
        col.setComponent(o.idx[k]!, c, from + (to - from) * w);
      }
      n++;
    }
    col.needsUpdate = true;
  }
  return n;
}
