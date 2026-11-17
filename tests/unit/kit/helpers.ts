import { expect } from 'vitest';
import type { BufferGeometry } from 'three';

/** Every invariant a kit geometry must hold. */
export function checkGeometry(g: BufferGeometry): void {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const surf = g.getAttribute('surf');
  expect(pos).toBeDefined();
  expect(nrm.count).toBe(pos.count);
  expect(col.count).toBe(pos.count);
  expect(surf.count).toBe(pos.count);
  expect(surf.itemSize).toBe(3);
  const lpos = g.getAttribute('lpos');
  expect(lpos).toBeDefined();
  expect(lpos.itemSize).toBe(3);
  expect(lpos.count).toBe(pos.count);
  for (const v of lpos.array) expect(Number.isFinite(v)).toBe(true);
  for (const a of [pos, nrm, col, surf]) for (const v of a.array) expect(Number.isFinite(v)).toBe(true);
  for (let i = 0; i < nrm.count; i++) expect(Math.abs(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) - 1)).toBeLessThan(1e-3);
  for (const v of surf.array) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  }
  const idx = g.index!.array;
  expect(idx.length % 3).toBe(0);
  let degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    expect(Math.max(a, b, c)).toBeLessThan(pos.count);
    const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
    const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area < 1e-12) degenerate++;
  }
  expect(degenerate).toBe(0);
}

