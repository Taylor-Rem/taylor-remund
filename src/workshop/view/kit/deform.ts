/**
 * Transforms and deformations that keep normals right.
 *
 * `transform` applies a Matrix4 (normals by the normal matrix, winding
 * flipped when the matrix mirrors). `deform` applies any smooth point map
 * and carries the normals through its Jacobian (cofactor matrix, by central
 * differences), so a taper, bend or bulge shades as if modelled that way.
 */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector3 } from 'three';
import { ATTR } from './types.ts';
import { surfFromCurvature } from './surface.ts';
import type { V3 } from './loft.ts';

/** Apply a matrix in place: positions, normals (normal matrix), winding flipped on mirror. Returns the geometry. */
export function transform(g: BufferGeometry, m: Matrix4): BufferGeometry {
  const pos = g.getAttribute('position') as BufferAttribute;
  const nrm = g.getAttribute('normal') as BufferAttribute | undefined;
  pos.applyMatrix4(m);
  pos.needsUpdate = true;
  if (nrm) {
    const nm = new Matrix3().getNormalMatrix(m);
    nrm.applyNormalMatrix(nm);
    nrm.needsUpdate = true;
  }
  if (m.determinant() < 0) flipWinding(g);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Reverse every triangle's winding (indexed or not). */
export function flipWinding(g: BufferGeometry): void {
  if (g.index) {
    const a = g.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1]!;
      a[i + 1] = a[i + 2]!;
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
    return;
  }
  for (const name of Object.keys(g.attributes)) {
    const attr = g.getAttribute(name) as BufferAttribute;
    const s = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < attr.count; i += 3) {
      for (let c = 0; c < s; c++) {
        const t = arr[(i + 1) * s + c]!;
        arr[(i + 1) * s + c] = arr[(i + 2) * s + c]!;
        arr[(i + 2) * s + c] = t;
      }
    }
    attr.needsUpdate = true;
  }
}

/**
 * Move every vertex through `f` and carry normals through f's Jacobian.
 * Wear and cavity are recomputed from the new shape unless `keepSurf`.
 */
export function deform(g: BufferGeometry, f: (x: number, y: number, z: number) => V3, opts: { keepSurf?: boolean; h?: number } = {}): BufferGeometry {
  const pos = g.getAttribute('position') as BufferAttribute;
  const nrm = g.getAttribute('normal') as BufferAttribute;
  const h = opts.h ?? 1e-4;
  const J = new Matrix3();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const px1 = f(x + h, y, z), px0 = f(x - h, y, z);
    const py1 = f(x, y + h, z), py0 = f(x, y - h, z);
    const pz1 = f(x, y, z + h), pz0 = f(x, y, z - h);
    const k = 1 / (2 * h);
    // columns are partial derivatives
    J.set(
      (px1[0] - px0[0]) * k, (py1[0] - py0[0]) * k, (pz1[0] - pz0[0]) * k,
      (px1[1] - px0[1]) * k, (py1[1] - py0[1]) * k, (pz1[1] - pz0[1]) * k,
      (px1[2] - px0[2]) * k, (py1[2] - py0[2]) * k, (pz1[2] - pz0[2]) * k,
    );
    // normal transforms by the inverse transpose
    const det = J.determinant();
    J.invert().transpose();
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(J);
    if (det < 0) n.negate();
    n.normalize();
    const p = f(x, y, z);
    pos.setXYZ(i, p[0], p[1], p[2]);
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  // wear and cavity are re-measured from the new shape, with the solid's own wear band
  // (geometry.userData.kitBand, written by finish) and keeping the finish channel; wear written
  // by intent (the cheap solids: userData.kitSurf = 'intent') is kept as it is
  if (!opts.keepSurf && g.userData['kitSurf'] !== 'intent' && g.getAttribute(ATTR.surf)) g.setAttribute(ATTR.surf, new BufferAttribute(surfFromCurvature(g), 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Taper along Y between y0 and y1: x and z are scaled about the Y axis from
 * 1 at y0 to (sx, sz) at y1, and shifted by (dx, dz) at y1. A wedge is a
 * taper with sx < 1 and a shift.
 */
export function taper(g: BufferGeometry, y0: number, y1: number, sx: number, sz: number, dx = 0, dz = 0): BufferGeometry {
  return deform(g, (x, y, z) => {
    const t = (y - y0) / (y1 - y0);
    return [x * (1 + (sx - 1) * t) + dx * t, y, z * (1 + (sz - 1) * t) + dz * t];
  });
}

/** Bend along X about an axis parallel to Z: a straight part of length L becomes an arc of `angle` radians. */
export function bend(g: BufferGeometry, angle: number, L: number): BufferGeometry {
  if (Math.abs(angle) < 1e-6) return g;
  const R = L / angle;
  return deform(g, (x, y, z) => {
    const a = x / R;
    return [(R - y) * Math.sin(a), R - (R - y) * Math.cos(a), z];
  });
}

/** Swell the sides outward in the middle of the height (soft, toy-like bodies). */
export function bulge(g: BufferGeometry, h: number, amount: number, y0 = 0): BufferGeometry {
  return deform(g, (x, y, z) => {
    const t = (y - y0) / h;
    const s = 1 + amount * Math.max(0, 4 * t * (1 - t));
    return [x * s, y, z * s];
  });
}

/** A small seeded dent: pushes the surface inward near a point (radius r, depth d) along -direction. */
export function dent(g: BufferGeometry, at: V3, dir: V3, r: number, d: number): BufferGeometry {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const nx = dir[0] / l, ny = dir[1] / l, nz = dir[2] / l;
  return deform(g, (x, y, z) => {
    const q = Math.hypot(x - at[0], y - at[1], z - at[2]) / r;
    if (q >= 1) return [x, y, z];
    const w = (1 - q * q) * (1 - q * q) * d;
    return [x - nx * w, y - ny * w, z - nz * w];
  });
}
