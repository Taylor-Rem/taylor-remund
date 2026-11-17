/**
 * The early-look tableau (REWRITE.md § G P1 "The early look"): where the
 * three objects stand, the stand-ins used until a piece is registered, and
 * the camera boxes of the four shots. Pure layout; the page realizes it.
 */
import { Box3, Vector3 } from 'three';
import type { Piece } from '../kit/types.ts';
import { roundedBox } from '../kit/solids.ts';
import { part, piece } from '../kit/compose.ts';
import type { Placement } from './mount.ts';

export type Role = 'button' | 'crate' | 'fetch';
export type Shot = 'three' | Role;

/**
 * The composition, in the lamp's pool (the key aims at about x 0.6, z -0.1
 * and its shadows fall forward and to the right): the Button centre-front,
 * the crate to its left a little askew and a step back, Fetch to its right
 * turned a little toward the camera.
 */
export const TABLEAU: Record<Role, Placement & { seed: number }> = {
  crate: { x: -1.3, z: 0.35, yaw: 13, seed: 3 },
  button: { x: 0.25, z: 0.85, yaw: -4, seed: 1 },
  fetch: { x: 1.8, z: 0.6, yaw: -16, seed: 2 },
};

/** Sizes of the stand-ins (art-direction § 2 and § 10): the Button on its pedestal, a crate M, Fetch with its aerial. */
export const STAND_IN: Record<Role, { w: number; h: number; d: number }> = {
  button: { w: 1.1, h: 1.45, d: 1.1 },
  crate: { w: 0.6, h: 0.6, d: 0.6 },
  fetch: { w: 0.8, h: 1.3, d: 0.7 },
};

/** A clearly temporary block of the right size (shown in clay). */
export function standInPiece(role: Role): Piece {
  const s = STAND_IN[role];
  const b = piece(`stand-in-${role}`, { ao: false });
  b.add(part('paper', roundedBox({ w: s.w, h: s.h, d: s.d, r: Math.min(s.w, s.d) * 0.08 }), 'paper'));
  return b.build();
}

/**
 * The box a shot frames (fitted with the catalogue's `close` distance): the
 * group with room round it for the pool and the dark beyond, or one object
 * with a little air.
 */
export function shotBox(shot: Shot, boxes: Record<Role, Box3>): Box3 {
  if (shot === 'three') {
    const u = new Box3();
    for (const b of Object.values(boxes)) u.union(b);
    // air: more to the sides and behind (the pool falling off), a little in front
    u.min.x -= 1.5;
    u.max.x += 1.5;
    u.min.z -= 2.2;
    u.max.z += 0.5;
    u.min.y = 0;
    return u;
  }
  const b = boxes[shot].clone();
  const s = b.getSize(new Vector3());
  b.expandByVector(new Vector3(s.x * 0.18, 0, s.z * 0.18));
  b.max.y += s.y * 0.06;
  return b;
}
