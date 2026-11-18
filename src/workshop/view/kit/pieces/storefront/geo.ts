/**
 * Small geometry helpers for the storefront: the slat faces (gridded, so a
 * paint wipe has columns to travel along), the awning's canvas strips with
 * their sag, the scalloped valance, and a quad textured from part of an
 * atlas. Everything writes the kit attributes through `finish`.
 */
import type { BufferGeometry } from 'three';
import { finish, MeshData } from '../../mesh.ts';
import { grain } from '../../space.ts';

/** A rectangle in the XY plane facing +Z (or -Z with `back`), nx × ny quads, at depth z. Optional uv rect. */
export function grid(x0: number, x1: number, y0: number, y1: number, z: number, nx: number, ny: number, o: { back?: boolean; uv?: readonly [number, number, number, number]; flipV?: boolean } = {}): BufferGeometry {
  const md = new MeshData();
  if (o.uv) md.withUv();
  const s = o.back ? -1 : 1;
  const ids: number[][] = [];
  for (let j = 0; j <= ny; j++) {
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const fx = i / nx, fy = j / ny;
      const x = x0 + (x1 - x0) * fx, y = y0 + (y1 - y0) * fy;
      let u = 0, v = 0;
      if (o.uv) {
        const [u0, v0, u1, v1] = o.uv;
        u = u0 + (u1 - u0) * fx;
        v = o.flipV ? v1 + (v0 - v1) * fy : v0 + (v1 - v0) * fy;
      }
      row.push(md.v(x, y, z, 0, 0, s, u, v));
    }
    ids.push(row);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) md.quad(ids[j]![i]!, ids[j]![i + 1]!, ids[j + 1]![i + 1]!, ids[j + 1]![i]!);
  return grain(finish(md), 'x');
}

/**
 * One awning stripe: a strip of canvas from z = 0 (the roller) to z = L along local +Z,
 * across x0..x1, sagging a little between the arms (`sag` at the middle of the run),
 * with a turned-down thickness so its edge reads. Facing +Y (up).
 */
export function canvasStrip(x0: number, x1: number, L: number, sag: number, nz: number, t = 0.006): BufferGeometry {
  const md = new MeshData();
  const sagAt = (z: number, x: number): number => {
    const a = Math.sin((Math.PI * z) / L);
    // the canvas billows a touch more away from the arms (at the middle of the width)
    const b = 0.55 + 0.45 * Math.cos((x / 0.94) * Math.PI * 0.5);
    return -sag * a * b;
  };
  const top: number[][] = [];
  const bot: number[][] = [];
  for (let j = 0; j <= nz; j++) {
    const z = (L * j) / nz;
    const rt: number[] = [], rb: number[] = [];
    for (const x of [x0, x1]) {
      const y = sagAt(z, x);
      // a slope normal from the sag derivative
      const dz = 0.002;
      const dy = (sagAt(Math.min(L, z + dz), x) - sagAt(Math.max(0, z - dz), x)) / (Math.min(L, z + dz) - Math.max(0, z - dz));
      rt.push(md.v(x, y, z, 0, 1, -dy));
      rb.push(md.v(x, y - t, z, 0, -1, dy));
    }
    top.push(rt);
    bot.push(rb);
  }
  for (let j = 0; j < nz; j++) {
    md.quad(top[j]![0]!, top[j + 1]![0]!, top[j + 1]![1]!, top[j]![1]!);
    md.quad(bot[j]![0]!, bot[j]![1]!, bot[j + 1]![1]!, bot[j + 1]![0]!);
  }
  // the cut edges at the stripe's two sides are seams; only the outermost stripes show them, so give every strip its sides (cheap)
  for (const [k, sx] of [[0, -1], [1, 1]] as const) {
    const side: number[] = [];
    for (let j = 0; j <= nz; j++) {
      const p = top[j]![k]!, q = bot[j]![k]!;
      side.push(md.v(md.pos[p * 3]!, md.pos[p * 3 + 1]!, md.pos[p * 3 + 2]!, sx, 0, 0), md.v(md.pos[q * 3]!, md.pos[q * 3 + 1]!, md.pos[q * 3 + 2]!, sx, 0, 0));
    }
    for (let j = 0; j < nz; j++) md.quad(side[j * 2]!, side[j * 2 + 2]!, side[j * 2 + 3]!, side[j * 2 + 1]!);
  }
  return grain(finish(md), 'z');
}

/**
 * One panel of the valance (the flap hanging from the awning's front bar): x0..x1,
 * from y = 0 down to -h, with a scalloped lower edge (one scallop per panel), a
 * hair of thickness, facing +Z. Built at z = 0.
 */
export function valancePanel(x0: number, x1: number, h: number, scallop: number, segs = 6, t = 0.005): BufferGeometry {
  const md = new MeshData();
  const w = x1 - x0;
  const front: number[] = [], back: number[] = [];
  const topF: number[] = [], topB: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const f = i / segs;
    const x = x0 + w * f;
    const yb = -h - scallop * Math.sin(Math.PI * f);
    front.push(md.v(x, yb, t, 0, 0, 1));
    topF.push(md.v(x, 0, t, 0, 0, 1));
    back.push(md.v(x, yb, 0, 0, 0, -1));
    topB.push(md.v(x, 0, 0, 0, 0, -1));
  }
  for (let i = 0; i < segs; i++) {
    md.quad(front[i]!, front[i + 1]!, topF[i + 1]!, topF[i]!);
    md.quad(back[i]!, topB[i]!, topB[i + 1]!, back[i + 1]!);
  }
  // the scalloped edge: a thin band facing down/out
  const e: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const p = front[i]!, q = back[i]!;
    const f = i / segs;
    const nx = -Math.cos(Math.PI * f) * 0.6;
    e.push(md.v(md.pos[p * 3]!, md.pos[p * 3 + 1]!, md.pos[p * 3 + 2]!, nx, -1, 0.2), md.v(md.pos[q * 3]!, md.pos[q * 3 + 1]!, md.pos[q * 3 + 2]!, nx, -1, -0.2));
  }
  for (let i = 0; i < segs; i++) md.quad(e[i * 2]!, e[i * 2 + 1]!, e[i * 2 + 3]!, e[i * 2 + 2]!);
  return grain(finish(md), 'x');
}
