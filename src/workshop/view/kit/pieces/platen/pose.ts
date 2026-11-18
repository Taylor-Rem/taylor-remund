/**
 * posePlaten: set the platen's moving nodes from a few numbers. Pure node
 * transform setting (position, rotation, scale; never geometry, material or
 * `visible`), so it behaves the same on both `realize` backends and on a
 * Piece's own node tree (a still built in a pose). No easing, no springs, no
 * time: the view drives it.
 *
 * The story, forwards: the arm swings over (`swing` 0 → 1), dips (`dip`),
 * paint runs out of the nozzle (`flow`) while the sight tube's level falls
 * (`level`) and the tray turns under the nozzle (`tray`); then the tape head
 * runs in (`press`) and lays a strip of tape (`tape`). Undo is the same
 * numbers run backwards: the stream shortens UP into the nozzle (its pivot is
 * the tip) while the sight tube refills, so paint is seen going back.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { PieceNode } from '../../types.ts';
import { PLATEN, YAW_IDLE, YAW_OVER } from './dims.ts';

export interface PlatenPose {
  /** 0 parked over the drip pot .. 1 over the middle of the tray. */
  swing?: number;
  /** 0 up .. 1 dipped: the arm rides down its column by POSE.dipDrop and tips POSE.dipDeg (the nozzle stays plumb). A part partly as tall (a 1.6 robot) is reached at a small dip. */
  dip?: number;
  /** The tray's turn, radians (positive turns anticlockwise seen from above). */
  tray?: number;
  /** The tape head's ram: 0 up .. 1 roller down on the part's top front edge. */
  press?: number;
  /** The label: 0 none .. 1 laid. The carriage runs left to right and the strip on the part grows behind the roller; undo runs it back and the strip peels off. */
  tape?: number;
  /** The paint stream out of the nozzle tip: 0 none .. 1 down to the part. Shortens toward the tip. */
  flow?: number;
  /** Paint in the sight tube: 0 empty .. 1 full. */
  level?: number;
  /** The pressure gauge: 0 .. 1 of its scale. */
  pressure?: number;
  /** The tank's hand wheel, radians. */
  wheel?: number;
  /** The station lamp: lit at 0.5 and above. */
  lamp?: number;
}

export const POSE = {
  /** The arm's yaw (about +Y, radians) parked over the drip pot and over the tray. */
  yawIdle: YAW_IDLE,
  yawOver: YAW_OVER,
  /** How far the arm pitches down at dip 1, degrees. */
  dipDeg: 0,
  /** How far the arm rides down its column at dip 1, world units. */
  dipDrop: 0.7,
  /** How far the tape head's ram drops the roller at press 1, world units. */
  pressTravel: 0.28,
  /** The gauge needle's sweep, degrees either side of straight up. */
  gaugeSweepDeg: 120,
};

/** The scale a hidden thing (the unlit lens when lit, an empty stream) is collapsed to. */
export const HIDDEN = 1e-4;

const DEG = Math.PI / 180;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The rest pose's numbers: what a freshly built platen shows. */
export const REST: Required<PlatenPose> = { swing: 0, dip: 0, tray: 0, press: 0, tape: 0, flow: 0, level: 0.78, pressure: 0.32, wheel: 0, lamp: 0 };

/** Named poses for the catalogue (`?pose=`) and the view. */
export const NAMED_POSES: Readonly<Record<string, PlatenPose>> = {
  idle: {},
  /** A text has come in: lamp on, arm swung over, pressure up. */
  over: { swing: 1, lamp: 1, pressure: 0.62 },
  /** Dipped and painting: the stream runs, the tube's level is falling, the tray part way round. */
  dipping: { swing: 1, dip: 1, flow: 1, level: 0.55, tray: 0.9, lamp: 1, pressure: 0.7, wheel: 1.4 },
  /** The arm has lifted back; the tape head is in, laying the label. */
  pressing: { swing: 1, dip: 1, press: 1, tape: 0.6, level: 0.55, tray: 0, lamp: 1, pressure: 0.55, wheel: 1.4 },
  /** Undo, half way: the stream is drawn up toward the tip and the tube is refilling. */
  draining: { swing: 1, dip: 0.85, flow: 0.4, level: 0.7, tray: 0.5, lamp: 1, pressure: 0.4, wheel: 0.7 },
};

/** Fill in a pose from the rest numbers. */
export function fullPose(p: PlatenPose): Required<PlatenPose> {
  return { ...REST, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Required<PlatenPose>;
}

const Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const q1 = new Quaternion(), q2 = new Quaternion();

/**
 * The local matrix a named node should have for this pose, given its rest
 * (as built, unposed: the REST numbers) local matrix, or null if this node
 * does not move. A piece built in a pose is for stills: realize and pose a
 * live one built at rest.
 */
export function localFor(name: string, rest: Matrix4, pose: Required<PlatenPose>): Matrix4 | null {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  rest.decompose(p, q, s);
  switch (name) {
    case 'arm': {
      // from rest (parked, up): down the column, round it, then tip the beam's +X end down
      const yaw = POSE.yawIdle + (POSE.yawOver - POSE.yawIdle) * clamp01(pose.swing);
      p.y -= clamp01(pose.dip) * POSE.dipDrop;
      q.multiply(q1.setFromAxisAngle(Y, yaw - POSE.yawIdle)).multiply(q2.setFromAxisAngle(Z, -clamp01(pose.dip) * POSE.dipDeg * DEG));
      break;
    }
    case 'nozzle':
      // counter the arm's pitch: the gooseneck stays plumb (a parallel link would do this)
      q.multiply(q1.setFromAxisAngle(Z, clamp01(pose.dip) * POSE.dipDeg * DEG));
      break;
    case 'tray':
      q.multiply(q1.setFromAxisAngle(Y, pose.tray));
      break;
    case 'tapehead':
      // the carriage runs along the beam as the tape goes on
      p.x += (PLATEN.labelHead.end - PLATEN.labelHead.start) * clamp01(pose.tape);
      break;
    case 'tapehead.ram':
      p.y -= POSE.pressTravel * clamp01(pose.press);
      break;
    case 'tapehead.reel':
      // the reel turns as tape pays out (its axis is the node's +Y)
      q.multiply(q1.setFromAxisAngle(Y, -clamp01(pose.tape) * ((PLATEN.labelHead.end - PLATEN.labelHead.start) / 0.075)));
      break;
    case 'label.strip': {
      const t = clamp01(pose.tape);
      s.set(Math.max(HIDDEN, t), t > 0.001 ? 1 : HIDDEN, t > 0.001 ? 1 : HIDDEN);
      break;
    }
    case 'nozzle.paint': {
      const f = clamp01(pose.flow);
      // a stream thins as it is drawn back up
      const w = f > 0.001 ? 0.55 + 0.45 * f : HIDDEN;
      s.set(w, Math.max(HIDDEN, f), w);
      break;
    }
    case 'sight.paint':
      // the column is built at the rest level
      s.set(1, Math.max(HIDDEN, clamp01(pose.level) / REST.level), 1);
      break;
    case 'gauge.needle':
      // the needle is built pointing at the rest pressure
      q.multiply(q1.setFromAxisAngle(Y, -(clamp01(pose.pressure) - REST.pressure) * 2 * POSE.gaugeSweepDeg * DEG));
      break;
    case 'handwheel':
      q.multiply(q1.setFromAxisAngle(Y, pose.wheel));
      break;
    case 'lamp.lit': {
      const on = pose.lamp >= 0.5 ? 1 : HIDDEN;
      s.set(on, on, on);
      break;
    }
    case 'lamp.unlit': {
      const on = pose.lamp >= 0.5 ? HIDDEN : 1;
      s.set(on, on, on);
      break;
    }
    default:
      return null;
  }
  return new Matrix4().compose(p, q, s);
}

/** The node's local matrix as `realize` made it (remembered on the first pose). */
function restOf(o: Object3D): Matrix4 {
  const u = o.userData as { platenRest?: Matrix4 };
  if (!u.platenRest) u.platenRest = new Matrix4().compose(o.position, o.quaternion, o.scale);
  return u.platenRest;
}

/**
 * Pose a realized platen (the Object3D `realize` made, or any ancestor of it).
 * Moves only the platen's named nodes; anything else is untouched.
 */
export function posePlaten(root: Object3D, pose: PlatenPose): void {
  const full = fullPose(pose);
  root.traverse((o) => {
    if (!o.name) return;
    const m = localFor(o.name, restOf(o), full);
    if (m) m.decompose(o.position, o.quaternion, o.scale);
  });
}

/**
 * The same pose applied to a Piece's node tree (its node transforms), for a
 * still built in a pose. The rest transform is kept in a side table so a node
 * tree can be re-posed; the cavity bake stays at rest.
 */
const PIECE_REST = new WeakMap<PieceNode, Matrix4>();
export function posePiece(root: PieceNode, pose: PlatenPose): void {
  const full = fullPose(pose);
  const walk = (n: PieceNode): void => {
    let rest = PIECE_REST.get(n);
    if (!rest) {
      rest = (n.transform ?? new Matrix4()).clone();
      PIECE_REST.set(n, rest);
    }
    const m = localFor(n.name, rest, full);
    if (m) n.transform = m;
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}
