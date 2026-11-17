/**
 * How a part's durable properties become physical ones (§ B1: size is "its
 * bulk, its weight"; material is "its bounce"). One table, so the feel is
 * tuned in one place.
 */
import type { PartKind, PartMaterial, PartSize, Vec3 } from './types.ts';

/** Edge length of a crate of each size, in units (1 unit = Fetch's body height; art-direction § 2). */
export const CRATE_EDGE: Readonly<Record<PartSize, number>> = { S: 0.45, M: 0.6, L: 0.8 };

/** Mass per cubic unit, friction, restitution, damping. */
export const MATERIAL: Readonly<Record<PartMaterial, { density: number; friction: number; restitution: number; linearDamping: number; angularDamping: number }>> = {
  wood: { density: 0.65, friction: 0.62, restitution: 0.18, linearDamping: 0.05, angularDamping: 0.25 },
  metal: { density: 2.4, friction: 0.42, restitution: 0.12, linearDamping: 0.03, angularDamping: 0.15 },
  paper: { density: 0.3, friction: 0.7, restitution: 0.06, linearDamping: 0.4, angularDamping: 0.8 },
  rubber: { density: 1.1, friction: 0.95, restitution: 0.62, linearDamping: 0.05, angularDamping: 0.3 },
};

/**
 * Shape of a crate is a cube with the size's edge. Robots and tools bring
 * their own extents (scene data); this is the default box for a kind.
 */
export function defaultHalfExtents(kind: PartKind, size: PartSize): Vec3 {
  const e = CRATE_EDGE[size] / 2;
  if (kind === 'robot') return [0.3, 0.5, 0.26];
  if (kind === 'tool') return [e, e * 0.25, e * 0.4];
  return [e, e, e];
}

/** Mass from the box volume and the material: weight comes from size and material, never from kind. */
export function massOf(half: Vec3, material: PartMaterial, fill = 1): number {
  return 8 * half[0] * half[1] * half[2] * MATERIAL[material].density * fill;
}
