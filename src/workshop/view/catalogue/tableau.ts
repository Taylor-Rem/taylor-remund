/**
 * The early-look tableau (REWRITE.md § G P1 "The early look", § B3): the
 * Button centre, a crate dropped askew to its left and a little forward (Fetch
 * has just fumbled it), Fetch to the right in its `offer` pose turned toward
 * the visitor; a run of lane tape in front; the bench nose and the dark
 * below it at the bottom of the frame, the lit back wall behind. Pure layout
 * and camera maths; the page realizes it.
 */
import { Box3, MathUtils, Vector3 } from 'three';
import type { Piece } from '../kit/types.ts';
import { roundedBox } from '../kit/solids.ts';
import { part, piece } from '../kit/compose.ts';
import type { Placement } from './mount.ts';
import { LENS } from './distances.ts';

export type Role = 'button' | 'crate' | 'fetch';
export type Shot = 'three' | Role | 'fetches';
export const SHOTS: readonly Shot[] = ['three', 'button', 'crate', 'fetch', 'fetches'];

/** Where the cluster stands: forward on the bench, so its nose and the dark below it frame the picture. */
export const CLUSTER = { x: 0.3, z: 2.6 } as const;

export const TABLEAU: Record<Role, Placement & { seed: number }> = {
  button: { x: CLUSTER.x, z: CLUSTER.z - 0.25, yaw: -5, seed: 1 },
  crate: { x: CLUSTER.x - 1.1, z: CLUSTER.z + 0.4, yaw: 23, seed: 3 },
  fetch: { x: CLUSTER.x + 1.25, z: CLUSTER.z + 0.1, yaw: -22, seed: 2 },
};

/** Both Fetch designs side by side for a choice (`?shot=fetches`), the same pose. */
export const FETCHES: ReadonlyArray<Placement & { seed: number }> = [
  { x: CLUSTER.x - 0.8, z: CLUSTER.z, yaw: -8, seed: 2 },
  { x: CLUSTER.x + 0.8, z: CLUSTER.z, yaw: 8, seed: 2 },
];

/**
 * The lamp for the early look: high over the back left, aimed at the cluster,
 * with a tighter cone than the stage's whole-bench default so the pool's edge
 * falls inside the frame (the lamp's own prop does not exist yet: not faked).
 */
export const LOOK_LAMP = { bulb: [-3.0, 5.6, -0.4] as const, aim: [CLUSTER.x + 0.2, 0, CLUSTER.z - 0.6] as const, angleDeg: 42 };

/** A run of lane tape in front of the cluster, a little off square (bench-plane points, x z). */
export const TAPE_RUN: ReadonlyArray<readonly [number, number]> = [
  [-6.5, CLUSTER.z + 1.45],
  [-1.2, CLUSTER.z + 1.5],
  [5.5, CLUSTER.z + 1.42],
];

/** Sizes of the stand-ins (art-direction § 2 and § 10). */
export const STAND_IN: Record<Role, { w: number; h: number; d: number }> = {
  button: { w: 1.1, h: 1.45, d: 1.1 },
  crate: { w: 0.6, h: 0.6, d: 0.6 },
  fetch: { w: 0.8, h: 1.3, d: 0.7 },
};

/** A clearly temporary block of the right size (drawn in clay). */
export function standInPiece(role: Role): Piece {
  const s = STAND_IN[role];
  const b = piece(`stand-in-${role}`, { ao: false });
  b.add(part('paper', roundedBox({ w: s.w, h: s.h, d: s.d, r: Math.min(s.w, s.d) * 0.08 }), 'paper'));
  return b.build();
}

/** A camera for a shot: where it looks (the sharp point) and how far back, at the stage's own lens and pitch. */
export interface ShotCamera {
  focus: Vector3;
  distance: number;
}

/** Distance at which `span` units fit across the frame's width at the focus. */
export function spanDistance(span: number, aspect: number, fov: number = LENS.fov): number {
  const tanV = Math.tan(MathUtils.degToRad(fov) / 2);
  return span / 2 / (tanV * aspect);
}

/**
 * The shots. The group is framed wide enough for the pool's edge and the
 * bench nose; the portraits put the subject off-centre with a neighbour
 * entering the frame, so each reads as a picture, not a zoom.
 */
export function shotCamera(shot: Shot, boxes: Partial<Record<Role | 'fetchA' | 'fetchB', Box3>>, aspect: number): ShotCamera {
  const c = (b: Box3 | undefined): Vector3 => (b ? b.getCenter(new Vector3()) : new Vector3(CLUSTER.x, 0.5, CLUSTER.z));
  const portrait = aspect < 1;
  const across = (wide: number, tall: number): number => (portrait ? spanDistance(tall, aspect) : spanDistance(wide, aspect));
  switch (shot) {
    case 'three': {
      const f = c(boxes.button);
      // look a little behind and below the Button: the group sits low, the lit bench and wall above
      // the group low in the frame: the wall above, the bench nose and the dark below
      // (on a portrait phone the spare height goes to the bench and wall behind, not the dark below)
      f.set(f.x + 0.15, 0.6, CLUSTER.z - (portrait ? 1.5 : 0.1));
      return { focus: f, distance: across(11.5, 5.6) };
    }
    case 'button': {
      const f = c(boxes.button);
      f.x -= 0.3; // the crate's corner enters on the left
      f.y = 0.45;
      f.z += 0.15;
      return { focus: f, distance: across(4.2, 2.8) };
    }
    case 'crate': {
      const f = c(boxes.crate);
      f.x += 0.3; // the Button's base rises behind on the right
      f.y = 0.3;
      return { focus: f, distance: across(2.2, 1.7) };
    }
    case 'fetch': {
      const f = c(boxes.fetch);
      f.x -= 0.25; // looking out of frame toward the Button
      f.y = Math.max(0.55, f.y * 0.9);
      return { focus: f, distance: across(2.6, 2.0) };
    }
    case 'fetches': {
      const u = new Box3();
      if (boxes.fetchA) u.union(boxes.fetchA);
      if (boxes.fetchB) u.union(boxes.fetchB);
      const f = u.isEmpty() ? c(undefined) : u.getCenter(new Vector3());
      f.y = Math.max(0.55, f.y);
      return { focus: f, distance: across(4.2, 2.6) };
    }
  }
}
