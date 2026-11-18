/**
 * Mouths (REWRITE.md § B1 law 2: "if it has a mouth, it takes anything
 * loose"). A mouth is a box on the bench declared in the scene; whatever
 * comes to rest with its centre inside it is offered to the mouth's machine
 * (the world does that, in one place: `rests()` in world.ts).
 */
import type { Vec3 } from './types.ts';
import type { MouthSpec } from './scene.ts';

const DEG = Math.PI / 180;

/** Is the point `p` (a part's centre) inside the mouth's box? */
export function inMouth(m: MouthSpec, p: Vec3): boolean {
  const dx = p[0] - m.c[0];
  const dy = p[1] - m.c[1];
  const dz = p[2] - m.c[2];
  // into the box's own frame: undo its turn about +Y
  const a = -(m.yaw ?? 0) * DEG;
  const lx = dx * Math.cos(a) + dz * Math.sin(a);
  const lz = -dx * Math.sin(a) + dz * Math.cos(a);
  return Math.abs(lx) <= m.half[0] && Math.abs(dy) <= m.half[1] && Math.abs(lz) <= m.half[2];
}
