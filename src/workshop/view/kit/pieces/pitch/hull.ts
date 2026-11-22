/**
 * Pitch's hull: a body of revolution about the Z axis (nose toward +Z), and
 * the things that sit on it: points and frames on its surface, ribbons laid
 * along it (gore seams, piping, a stripe), and patches of its skin (a shirt
 * front, a painted band) offset a hair above it. Pure geometry, no colour.
 *
 * Angles round the axis: phi = 0 on top (+Y), phi = PI/2 on the visitor's
 * right (+X), PI underneath.
 */
import { BufferGeometry, Vector3 } from 'three';
import { MeshData, finish } from '../../mesh.ts';

export type RGB = [number, number, number];

export interface HullShape {
  /** Length from the widest section to the nose tip (+Z). */
  nose: number;
  /** Length from the widest section to the tail tip (-Z). */
  tail: number;
  /** Radius at the widest section. */
  r: number;
  /** Nose bluntness: the exponent of the nose's superellipse (2 is an ellipse; more is blunter). */
  noseK: number;
  /** Tail: r = R·(1 − u^tailK)^tailQ with u the fraction of the way to the tail tip. */
  tailK: number;
  tailQ: number;
  /** Squash in Y (1: round sections; < 1: a little flattened, a portly belly). */
  sy?: number;
}

/** Radius of the hull at z (0 outside it). */
export function hullR(h: HullShape, z: number): number {
  if (z >= 0) {
    const u = Math.min(1, z / h.nose);
    return h.r * Math.pow(Math.max(0, 1 - Math.pow(u, h.noseK)), 1 / h.noseK);
  }
  const u = Math.min(1, -z / h.tail);
  return h.r * Math.pow(Math.max(0, 1 - Math.pow(u, h.tailK)), h.tailQ);
}

/** dr/dz by a small central difference (finite near the tips). */
function hullDr(h: HullShape, z: number): number {
  const e = 1e-4;
  return (hullR(h, z + e) - hullR(h, z - e)) / (2 * e);
}

/** The z of ring i of n, packed toward both tips (where the curvature is). */
export function ringZ(h: HullShape, i: number, n: number): number {
  const s = i / n;
  const t = (1 - Math.cos(Math.PI * s)) / 2;
  // a little denser toward the nose than the tail
  const w = Math.pow(t, 0.92);
  return -h.tail + (h.nose + h.tail) * w;
}

/** A point on the hull surface (lifted `lift` along its normal) and its normal. */
export function onHull(h: HullShape, z: number, phi: number, lift = 0): { p: Vector3; n: Vector3 } {
  const r = hullR(h, z);
  const dr = hullDr(h, z);
  const sy = h.sy ?? 1;
  // the section is an ellipse r·(sin φ, sy·cos φ); its normal in the section is (sin φ·sy, cos φ) scaled
  const sx = Math.sin(phi), cy = Math.cos(phi);
  const nx = sx * sy, ny = cy, nzz = -dr * Math.hypot(sx * sy, cy);
  const n = new Vector3(nx, ny, nzz).normalize();
  const p = new Vector3(r * sx, r * cy * sy, z).addScaledVector(n, lift);
  return { p, n };
}

/** The hull itself: `rings` sections along Z, `segs` round. Tips are single points. */
export function hullGeometry(h: HullShape, rings: number, segs: number): BufferGeometry {
  const md = new MeshData();
  const sy = h.sy ?? 1;
  const idx: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const z = ringZ(h, i, rings);
    const tip = i === 0 || i === rings;
    const row: number[] = [];
    if (tip) {
      const nz = i === 0 ? -1 : 1;
      const zz = i === 0 ? -h.tail : h.nose;
      for (let k = 0; k < segs; k++) row.push(md.v(0, 0, zz, 0, 0, nz));
    } else {
      const r = hullR(h, z);
      const dr = hullDr(h, z);
      for (let k = 0; k < segs; k++) {
        const phi = (k / segs) * Math.PI * 2;
        const sx = Math.sin(phi), cy = Math.cos(phi);
        const nx = sx * sy, ny = cy;
        row.push(md.v(r * sx, r * cy * sy, z, nx, ny, -dr * Math.hypot(nx, ny)));
      }
    }
    idx.push(row);
  }
  for (let i = 0; i < rings; i++) {
    const a = idx[i]!, b = idx[i + 1]!;
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      md.quad(a[k]!, a[k1]!, b[k1]!, b[k]!);
    }
  }
  return finish(md);
}

/**
 * A flat ribbon lying on the hull along a curve given in (z, phi) samples: `width` wide, `lift`
 * above the skin. Two triangles a segment. Several curves go in one geometry.
 */
export function hullRibbons(h: HullShape, curves: ReadonlyArray<ReadonlyArray<readonly [number, number]>>, width: number, lift = 0.0015): BufferGeometry {
  const md = new MeshData();
  for (const c of curves) {
    if (c.length < 2) continue;
    const pts = c.map(([z, phi]) => onHull(h, z, phi, lift));
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < pts.length; k++) {
      const prev = pts[Math.max(0, k - 1)]!.p, next = pts[Math.min(pts.length - 1, k + 1)]!.p;
      const t = next.clone().sub(prev).normalize();
      const { p, n } = pts[k]!;
      const side = new Vector3().crossVectors(n, t).normalize().multiplyScalar(width / 2);
      const a = p.clone().add(side), b = p.clone().sub(side);
      pairs.push([md.v(a.x, a.y, a.z, n.x, n.y, n.z), md.v(b.x, b.y, b.z, n.x, n.y, n.z)]);
    }
    for (let k = 0; k + 1 < pairs.length; k++) md.quad(pairs[k]![0], pairs[k + 1]![0], pairs[k + 1]![1], pairs[k]![1]);
  }
  return finish(md);
}

/**
 * A patch of skin over the hull between z0 and z1, phi from lo(z) to hi(z) (radians, may straddle
 * PI), lifted `lift`, with a rolled edge `edge` wide that tucks back down to the skin (so it reads as
 * cloth or paint laid on, not a decal). `nz`, `nphi` samples.
 */
export function hullPatch(
  h: HullShape,
  z0: number,
  z1: number,
  lo: (z: number) => number,
  hi: (z: number) => number,
  o: { lift?: number; nz?: number; nphi?: number; tuck?: number } = {},
): BufferGeometry {
  const md = new MeshData();
  const lift = o.lift ?? 0.004;
  const nz = o.nz ?? 10, np = o.nphi ?? 8;
  const tuck = o.tuck ?? 0.0;
  const grid: number[][] = [];
  for (let i = 0; i <= nz; i++) {
    const z = z0 + ((z1 - z0) * i) / nz;
    const a = lo(z), b = hi(z);
    const row: number[] = [];
    for (let k = 0; k <= np; k++) {
      const phi = a + ((b - a) * k) / np;
      const edge = i === 0 || i === nz || k === 0 || k === np;
      const { p, n } = onHull(h, z, phi, edge ? lift - tuck : lift);
      row.push(md.v(p.x, p.y, p.z, n.x, n.y, n.z));
    }
    grid.push(row);
  }
  for (let i = 0; i < nz; i++) for (let k = 0; k < np; k++) md.quad(grid[i]![k]!, grid[i]![k + 1]!, grid[i + 1]![k + 1]!, grid[i + 1]![k]!);
  return finish(md);
}

/**
 * A ring band round the hull from z0 to z1, standing `lift` proud, with rounded shoulders. `tilt` leans
 * it: the band sits `tilt` further aft on top and further forward underneath (a collar under a chin).
 */
export function hullBand(h: HullShape, z0: number, z1: number, lift: number, segs: number, tilt = 0): BufferGeometry {
  const md = new MeshData();
  const prof: Array<[number, number]> = [
    [z0, 0],
    [z0 + (z1 - z0) * 0.18, lift],
    [z0 + (z1 - z0) * 0.82, lift],
    [z1, 0],
  ];
  const rows: number[][] = [];
  for (let j = 0; j < prof.length; j++) {
    const [z, l] = prof[j]!;
    const row: number[] = [];
    for (let k = 0; k < segs; k++) {
      const phi = (k / segs) * Math.PI * 2;
      const { p, n } = onHull(h, z - tilt * Math.cos(phi), phi, l);
      // shoulders lean their normals fore and aft
      const lean = j === 0 ? -0.9 : j === 1 ? -0.25 : j === prof.length - 1 ? 0.9 : j === prof.length - 2 ? 0.25 : 0;
      const nn = n.clone().add(new Vector3(0, 0, lean)).normalize();
      row.push(md.v(p.x, p.y, p.z, nn.x, nn.y, nn.z));
    }
    rows.push(row);
  }
  for (let j = 0; j + 1 < rows.length; j++)
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      md.quad(rows[j]![k]!, rows[j]![k1]!, rows[j + 1]![k1]!, rows[j + 1]![k]!);
    }
  return finish(md);
}

/** Paint a geometry one linear colour, with a function that may vary it per vertex. In place. */
export function colourBy(g: BufferGeometry, f: (x: number, y: number, z: number) => RGB): BufferGeometry {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const c = f(pos.getX(i), pos.getY(i), pos.getZ(i));
    col.setXYZ(i, c[0], c[1], c[2]);
  }
  col.needsUpdate = true;
  return g;
}
