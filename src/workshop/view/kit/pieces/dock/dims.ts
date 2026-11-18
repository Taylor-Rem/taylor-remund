/**
 * The dock's fixed dimensions and the roller ramp's centre line, as pure
 * maths, so the geometry, the poses, the sockets and (later) the
 * simulation's colliders all agree.
 *
 * Frame. The piece's origin is the middle of the door on the bench plane
 * (y = 0), axes world-aligned like every piece (+X right, +Z toward the
 * visitor): place it with NO yaw. The bay itself is turned inside the
 * piece: its door looks out along `doorNormal(turn)`, which is -X turned
 * `turn` degrees toward the visitor (turn 40 is a +Z-facing bay yawed -50°),
 * so the camera (in front, about 33° up) sees the shutter's face and the
 * crate go in. The ramp leaves the belt along +X at the belt's height, runs
 * straight for `approach`, then bends left (toward the back) by `turn` on a
 * radius `r`, falling to the sill, so whatever rides it enters square to
 * the door. `fitRamp` finds approach and radius for a given belt end.
 */
import { Matrix4 } from 'three';

export const DOCK = {
  /** Default turn of the bay toward the camera (degrees from facing -X). 40 = the blockout's yaw -50. */
  turn: 40,
  /** The clear opening (door-local): width, and height above the sill. A robot 1.6 tall and 1.25 wide passes. */
  openW: 1.48,
  openH: 1.72,
  /** Sill height: the top of the threshold plate, where the ramp lands. */
  sillY: 0.1,
  /** Jamb (post) width across the door. */
  jambW: 0.2,
  /** The shutter's plane (door-local z), its slat pitch. */
  shutterZ: -0.04,
  slatPitch: 0.1,
  /** The drum housing over the opening: height. */
  housingH: 0.3,
  /** How far the bay runs back from the door plane (door-local -Z). */
  bayDepth: 0.85,
  /** The lip of the threshold in front of the door (door-local +Z) where the ramp meets it. */
  lipZ: 0.24,
  /** The ramp: its width (as the belt's), its rollers' top at the belt end, the straight lead into the lip. */
  rampW: 0.92,
  rampTopIn: 0.5,
  rampLead: 0.12,
  rollerR: 0.046,
  rollerPitch: 0.22,
  /** Rails: |offset| of the inner faces from the centre line, top above the roller tops. */
  railIn: 0.5,
  railProud: 0.05,
  /** Where the ramp's first roller sits past the belt's bed end. */
  beltGap: 0.12,
  /**
   * The default ramp start, relative to the door's origin: the blockout's belt bed end (4.6, z 3.7)
   * plus the gap, from the dock's spot (7.35, 3.25). See `fitRamp`.
   */
  reach: [-2.63, 0.45] as readonly [number, number],
} as const;

const DEG = Math.PI / 180;

/** The door's outward normal in the piece frame (unit, y = 0): -X turned `turn` degrees toward +Z. */
export function doorNormal(turn: number = DOCK.turn): [number, number, number] {
  const b = (90 - turn) * DEG;
  return [-Math.sin(b), 0, Math.cos(b)];
}

/** The door's frame: door-local +Z is its outward normal, +Y up, origin the middle of the door on y = 0. */
export function doorFrame(turn: number = DOCK.turn): Matrix4 {
  return new Matrix4().makeRotationY(-(90 - turn) * DEG);
}

/** One point of the ramp's centre line: position, heading (unit, in XZ), and `s` the distance from the ramp's start. */
export interface RampPoint {
  x: number;
  y: number;
  z: number;
  /** Heading, unit, y = 0 (the direction things ride). */
  hx: number;
  hz: number;
  s: number;
}

/** The ramp's geometry. */
export interface RampGeom {
  turn: number;
  /** Start of the ramp (roller tops at the belt end), heading +X. */
  start: [number, number, number];
  /** The point on the lip where the ramp ends, heading into the door. */
  end: [number, number, number];
  /** The straight run before the turn. */
  approach: number;
  /** Centre of the turn (XZ) and its radius, the arc's length. */
  cx: number;
  cz: number;
  r: number;
  arc: number;
  lead: number;
  length: number;
  /** Height of the roller tops at start and end. */
  y0: number;
  y1: number;
}

/**
 * Approach and radius so the ramp starts at `reach` = [dx, dz] from the door's origin (heading +X).
 * The radius is what the turn needs to make up dz; it is clamped to [0.75, 2.2] (tighter than 0.75
 * and the inner rail runs into the rollers' ends), and the approach takes up the rest of dx.
 */
export function fitRamp(reach: readonly [number, number] = DOCK.reach, turn: number = DOCK.turn): { approach: number; r: number } {
  const t = turn * DEG;
  const [nx, , nz] = doorNormal(turn);
  const d = DOCK.lipZ + DOCK.rampLead;
  const lx = nx * d, lz = nz * d;
  const r = Math.max(0.75, Math.min(2.2, (reach[1] - lz) / (1 - Math.cos(t))));
  const cx = lx - r * Math.sin(t);
  return { approach: Math.max(0, cx - reach[0]), r };
}

export function rampGeom(turn: number = DOCK.turn, reach: readonly [number, number] = DOCK.reach): RampGeom {
  const t = turn * DEG;
  const { approach, r } = fitRamp(reach, turn);
  const [nx, , nz] = doorNormal(turn);
  const qx = nx * DOCK.lipZ, qz = nz * DOCK.lipZ;
  const lx = qx + nx * DOCK.rampLead, lz = qz + nz * DOCK.rampLead;
  const cx = lx - r * Math.sin(t), cz = lz - r * Math.cos(t);
  const arc = r * t;
  return {
    turn,
    start: [cx - approach, DOCK.rampTopIn, cz + r],
    end: [qx, DOCK.sillY, qz],
    approach,
    cx, cz, r, arc,
    lead: DOCK.rampLead,
    length: approach + arc + DOCK.rampLead,
    y0: DOCK.rampTopIn,
    y1: DOCK.sillY,
  };
}

/**
 * The ramp's centre line (roller tops) at distance s from its start. It falls on an eased curve:
 * level off the belt, steepest in the turn, level again onto the sill.
 */
export function rampAt(g: RampGeom, sIn: number): RampPoint {
  const s = Math.max(0, sIn);
  const u = Math.min(1, s / g.length);
  const y = g.y0 + (g.y1 - g.y0) * (u * u * (3 - 2 * u));
  if (s <= g.approach) return { x: g.cx - g.approach + s, y, z: g.cz + g.r, hx: 1, hz: 0, s };
  const sa = s - g.approach;
  if (sa <= g.arc) {
    const th = sa / g.r;
    return { x: g.cx + g.r * Math.sin(th), y, z: g.cz + g.r * Math.cos(th), hx: Math.cos(th), hz: -Math.sin(th), s };
  }
  const t = (g.turn * Math.PI) / 180;
  const hx = Math.cos(t), hz = -Math.sin(t);
  const v = sa - g.arc;
  return { x: g.cx + g.r * Math.sin(t) + hx * v, y, z: g.cz + g.r * Math.cos(t) + hz * v, hx, hz, s };
}
