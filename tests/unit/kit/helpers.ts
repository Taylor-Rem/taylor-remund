import { expect } from 'vitest';
import type { BufferGeometry } from 'three';

/**
 * Every invariant a kit geometry must hold. Counts failures in plain loops and asserts the
 * counts, so a geometry of thousands of vertices costs a few expects, not thousands (the suite
 * shares the machine with the physics scenarios).
 */
export function checkGeometry(g: BufferGeometry): void {
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const surf = g.getAttribute('surf');
  const lpos = g.getAttribute('lpos');
  expect(pos).toBeDefined();
  expect(lpos).toBeDefined();
  expect(nrm.count).toBe(pos.count);
  expect(col.count).toBe(pos.count);
  expect(surf.count).toBe(pos.count);
  expect(surf.itemSize).toBe(3);
  expect(lpos.itemSize).toBe(3);
  expect(lpos.count).toBe(pos.count);
  let nonFinite = 0;
  for (const a of [pos, nrm, col, surf, lpos]) for (const v of a.array) if (!Number.isFinite(v)) nonFinite++;
  expect(nonFinite).toBe(0);
  let notUnit = 0;
  for (let i = 0; i < nrm.count; i++) if (Math.abs(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) - 1) >= 1e-3) notUnit++;
  expect(notUnit).toBe(0);
  let outOfRange = 0;
  for (const v of surf.array) if (v < 0 || v > 1) outOfRange++;
  expect(outOfRange).toBe(0);
  const idx = g.index!.array;
  expect(idx.length % 3).toBe(0);
  let degenerate = 0, badIndex = 0;
  const p = pos.array;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    if (Math.max(a, b, c) >= pos.count) { badIndex++; continue; }
    const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
    const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (area < 1e-12) degenerate++;
  }
  expect(badIndex).toBe(0);
  expect(degenerate).toBe(0);
}
