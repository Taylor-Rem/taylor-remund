/**
 * Material space and finish: the two per-vertex channels a builder sets by
 * intent rather than by geometry (kit/types.ts, "Vertex attributes").
 *
 *  - lpos (vec3): where a vertex sits in its own part's frame, +X along the
 *    part's length. Written when a solid is made; `place`, `transform`,
 *    `deform`, `merge` and node animation never touch it. `grain` re-aims it.
 *    The piece builder adds a seeded offset per part along +X at build time
 *    (see compose.ts `PieceBuilder.build`), so identical parts never share
 *    chips; y and z are untouched, so the part's own axis stays at y = z = 0.
 *  - surf.z (finish): 0 = the class's normal finish, 1 = high gloss/polished.
 */
import { BufferAttribute, Matrix4, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { ATTR } from './types.ts';
import type { KitPart } from './types.ts';

type GeomOrParts = BufferGeometry | KitPart | ReadonlyArray<GeomOrParts>;

function geoms(p: GeomOrParts): BufferGeometry[] {
  if (Array.isArray(p)) return (p as ReadonlyArray<GeomOrParts>).flatMap(geoms);
  if ((p as KitPart).geometry) return [(p as KitPart).geometry];
  return [p as BufferGeometry];
}

/**
 * Re-aim a part's material space. `along` = 'x' | 'y' | 'z': lpos is reset
 * from the geometry's current position with that axis as +X (the others
 * follow cyclically, so handedness is kept). A Matrix4 instead transforms
 * the existing lpos (e.g. a rotation to turn grain 90° on a panel).
 * Returns its argument.
 */
export function grain<T extends GeomOrParts>(p: T, along: 'x' | 'y' | 'z' | Matrix4): T {
  for (const g of geoms(p)) {
    const n = g.getAttribute('position').count;
    if (along instanceof Matrix4) {
      const l = lposOf(g);
      const v = new Vector3();
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(l, i).applyMatrix4(along);
        l.setXYZ(i, v.x, v.y, v.z);
      }
      l.needsUpdate = true;
      continue;
    }
    const pos = g.getAttribute('position');
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const [a, b, c] = along === 'x' ? [x, y, z] : along === 'y' ? [y, z, x] : [z, x, y];
      out[i * 3] = a;
      out[i * 3 + 1] = b;
      out[i * 3 + 2] = c;
    }
    g.setAttribute(ATTR.lpos, new BufferAttribute(out, 3));
  }
  return p;
}

/** The geometry's lpos attribute, created from its positions if missing. */
export function lposOf(g: BufferGeometry): BufferAttribute {
  let l = g.getAttribute(ATTR.lpos) as BufferAttribute | undefined;
  if (!l) {
    l = new BufferAttribute(new Float32Array(g.getAttribute('position').array as ArrayLike<number>), 3);
    g.setAttribute(ATTR.lpos, l);
  }
  return l;
}

/** Add an offset to a geometry's lpos (in place). */
export function offsetLpos(g: BufferGeometry, dx: number, dy: number, dz: number): void {
  const l = lposOf(g);
  const a = l.array as Float32Array;
  for (let i = 0; i < a.length; i += 3) {
    a[i] = a[i]! + dx;
    a[i + 1] = a[i + 1]! + dy;
    a[i + 2] = a[i + 2]! + dz;
  }
  l.needsUpdate = true;
}

/**
 * Set the finish channel (surf.z): 0 = the class's normal finish, 1 = high
 * gloss / polished. E.g. `setFinish(cap, 1)` makes the Button's cap glossy
 * red while the pedestal, in the same `steel` class, stays satin. An optional
 * `where(x, y, z)` (in the geometry's current space) limits it to some vertices.
 * Returns its argument.
 */
export function setFinish<T extends GeomOrParts>(p: T, value: number, where?: (x: number, y: number, z: number) => boolean): T {
  const v = Math.max(0, Math.min(1, value));
  for (const g of geoms(p)) {
    const s = g.getAttribute(ATTR.surf) as BufferAttribute;
    const pos = g.getAttribute('position');
    for (let i = 0; i < s.count; i++) if (!where || where(pos.getX(i), pos.getY(i), pos.getZ(i))) s.setZ(i, v);
    s.needsUpdate = true;
  }
  return p;
}
