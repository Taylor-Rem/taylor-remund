/**
 * The dock's own cheap shapes: a corrugated shutter slat, and a dent that
 * keeps a solid's wear. Built straight into the kit's MeshData, so a slat
 * costs a couple of dozen triangles and there can be a dozen of them.
 */
import type { BufferGeometry } from 'three';
import { finish, MeshData } from '../../mesh.ts';
import { deform } from '../../deform.ts';

/**
 * One slat of a roll-up shutter: a sheet `w` long (along X, centred), `h`
 * tall (from y = 0), pressed into one rounded rib that stands `bulge` proud
 * toward +Z; its top and bottom edges curl back `t` so neighbours meet in a
 * dark V. Front and the two curled edges only: its ends run into the guides
 * and its back faces the dark.
 */
export function slatGeom(w: number, h: number, bulge: number, t: number, rows = 6, cols = 1): BufferGeometry {
  const md = new MeshData();
  // the section: (y, z, ny, nz) samples from the bottom curl, up the face, to the top curl
  const sec: Array<[number, number, number, number]> = [];
  sec.push([0.004, -t, 0, -1]);
  sec.push([0, -t * 0.25, -0.9, 0.45]);
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    // a flattened sine: the rib is broad on top, its flanks fall quickly into the seams
    const s = Math.sin(Math.PI * u);
    const z = bulge * Math.pow(s, 0.6);
    const dz = bulge * 0.6 * Math.pow(Math.max(s, 1e-3), -0.4) * Math.cos(Math.PI * u) * (Math.PI / h);
    sec.push([u * h, z, -dz, 1]);
  }
  sec.push([h, -t * 0.25, 0.9, 0.45]);
  sec.push([h - 0.004, -t, 0, 1]);
  const grid: number[][] = [];
  for (let c = 0; c <= cols; c++) {
    const x = -w / 2 + (w * c) / cols;
    grid.push(sec.map(([y, z, ny, nz]) => md.v(x, y, z, 0, ny, nz)));
  }
  for (let c = 0; c < cols; c++) for (let i = 0; i < sec.length - 1; i++) md.quad(grid[c]![i]!, grid[c + 1]![i]!, grid[c + 1]![i + 1]!, grid[c]![i + 1]!);
  return finish(md);
}

/**
 * Paint: a convex polygon (from `stripes`) laid flat as a fan, n - 2 triangles, no walls.
 * `plane` 'xy' faces +Z (u = x, v = y); 'xz' faces +Y (u = x, v = z).
 */
export function paintPoly(poly: ReadonlyArray<readonly [number, number]>, plane: 'xy' | 'xz'): BufferGeometry {
  const md = new MeshData();
  const ids = poly.map(([u, v]) => (plane === 'xy' ? md.v(u, v, 0, 0, 0, 1) : md.v(u, 0, v, 0, 1, 0)));
  for (let i = 1; i < ids.length - 1; i++) md.tri(ids[0]!, ids[i]!, ids[i + 1]!);
  return finish(md);
}

/** A dent that keeps the solid's wear and cavity (the kit's `dent` re-measures them). */
export function dentKeep(g: BufferGeometry, at: [number, number, number], dir: [number, number, number], r: number, d: number): BufferGeometry {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const nx = dir[0] / l, ny = dir[1] / l, nz = dir[2] / l;
  return deform(g, (x, y, z) => {
    const q = Math.hypot(x - at[0], y - at[1], z - at[2]) / r;
    if (q >= 1) return [x, y, z];
    const k = (1 - q * q) * (1 - q * q) * d;
    return [x - nx * k, y - ny * k, z - nz * k];
  }, { keepSurf: true });
}
