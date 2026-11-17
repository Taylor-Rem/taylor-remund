/**
 * Patch, the operator (REWRITE.md § B5 "Patch", art-direction § 8): a first
 * pass. Patch sits on its stool at the board, side-on to the camera, and
 * never leaves it. Its head follows the action, slowly (an unimpressed
 * raccoon does not snap round): the plug while the visitor has it, else
 * whatever the pointer is over nearby, else Fetch. Pull the cord out and
 * Patch looks at the plug, then, slowly, at the visitor (§ B5 "looks at the
 * dead plug, then slowly at the visitor").
 *
 * The piece is `patch-felt` or `patch-toy` (the vignette's `?patch=`),
 * driven through its own `posePatch(root, pose)` and named `EXPRESSIONS`
 * when the module exports them; otherwise the `head` node is turned
 * directly. A clay stand-in of Patch's size holds the stool until either
 * lands. A character animator may deepen all of this later.
 */
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import type { Vec3 } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { part, piece, place, T } from '../kit/compose.ts';
import { roundedBox, ellipsoid } from '../kit/solids.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import type { Fit } from '../vignette.ts';

/** Tune here. Angles in radians, rates in 1/s. */
export const PATCH_FEEL = {
  /** How fast the head turns toward what it watches (slow: it is not impressed). */
  turnRate: 2.6,
  /** The look at the visitor: how long it stares at the dead plug first, then how long the look lasts. */
  plugStare: 1.1,
  lookHold: 2.4,
  /** Head limits about the body: yaw either side, pitch down/up. */
  yawMax: 1.35,
  pitchMin: -0.5,
  pitchMax: 0.35,
  /** Pointer interest: things nearer than this to Patch get looked at. */
  near: 4.5,
  /** Where the visitor is (for the look): toward the camera, out front. */
  visitor: [0.6, 2.4, 14] as Vec3,
  /** Which way Patch faces on its stool (degrees about +Y; 90 = toward +X, side-on to the camera). */
  facing: 96,
};

export interface PatchViewOptions {
  entry: Entry | undefined;
  module: Record<string, unknown> | null;
  fit: Fit;
  seed: number;
}

/** The stand-in: a clay body of Patch's seated size with a head node (so the head-follow can be judged). */
function standInPatch(): Piece {
  const b = piece('stand-in-patch', { ao: false });
  b.add(place(part('paper', roundedBox({ w: 0.62, h: 0.62, d: 0.52, r: 0.16 }), 'paper'), T(0, 0.31, 0)));
  const head = b.node('head', T(0, 0.66, 0.03));
  head.add(place(part('paper', ellipsoid({ rx: 0.24, ry: 0.22, rz: 0.22 }), 'paper'), T(0, 0.18, 0.02)));
  // a snout so its gaze can be read
  head.add(place(part('paper', ellipsoid({ rx: 0.09, ry: 0.08, rz: 0.12 }), 'paper'), T(0, 0.14, 0.24)));
  return b.build();
}

type PoseFn = (root: Object3D, pose: Record<string, unknown>) => void;

const tv = new Vector3();
const tq = new Quaternion();

export function createPatchView(o: PatchViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = PATCH_FEEL;
    const p = o.entry ? buildEntry(o.entry, null, { seed: o.seed }, ctx.labels) : standInPatch();
    const obj = ctx.realize(p);
    const root = new Group();
    root.name = 'patch';
    const seat = o.fit.stool.seat;
    root.position.set(seat[0], seat[1], seat[2]);
    root.rotation.y = (F.facing * Math.PI) / 180;
    root.add(obj);
    ctx.scene.add(root);
    root.updateMatrixWorld(true);

    const posePatch = (o.module?.['posePatch'] as PoseFn | undefined) ?? null;
    const head = obj.getObjectByName('head') ?? null;
    const headRest = head ? head.quaternion.clone() : null;
    const headWorld = new Vector3();
    (head ?? obj).getWorldPosition(headWorld);
    headWorld.y += 0.15;

    let yaw = 0;
    let pitch = 0;
    let lookUntil = -1;
    let stareUntil = -1;
    const target = new Vector3();
    const local = new Vector3();
    const inv = new Quaternion();

    const want = (w: Frame['world'], frame: Frame): string => {
      const t = frame.time;
      const cord = w.cord('cord');
      if (t < stareUntil && cord) {
        const pa = cord.plugAt ?? w.scene.cord.jacks.find((j) => j.id === cord.jack)?.at;
        if (pa) target.set(pa[0], pa[1], pa[2]);
        return 'working';
      }
      if (t < lookUntil) {
        target.set(...F.visitor);
        return 'the-look';
      }
      if (cord?.lifted && cord.plugAt) {
        target.set(cord.plugAt[0], cord.plugAt[1], cord.plugAt[2]);
        return 'working';
      }
      if (frame.pointer && frame.hovered) {
        tv.set(frame.pointer[0], frame.pointer[1], frame.pointer[2]);
        if (tv.distanceTo(headWorld) < F.near) {
          target.copy(tv);
          return 'unimpressed';
        }
      }
      const f = w.crew('fetch');
      if (f) {
        target.set(f.x, 0.6, f.z);
        return 'unimpressed';
      }
      target.set(...F.visitor);
      return 'unimpressed';
    };

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        for (const e of frame.events) {
          if (e.type === 'cord.unplugged') {
            stareUntil = frame.time + F.plugStare;
            lookUntil = stareUntil + F.lookHold;
          }
          if (e.type === 'cord.plugged') stareUntil = Math.min(stareUntil, frame.time);
        }
        const expression = want(w, frame);
        // the target in Patch's own frame (facing +Z locally)
        inv.copy(root.quaternion).invert();
        local.copy(target).sub(headWorld).applyQuaternion(inv);
        const gy = Math.max(-F.yawMax, Math.min(F.yawMax, Math.atan2(local.x, local.z)));
        const gp = Math.max(F.pitchMin, Math.min(F.pitchMax, Math.atan2(local.y, Math.hypot(local.x, local.z))));
        const dt = Math.min(frame.dt, 0.1);
        const k = 1 - Math.exp(-(expression === 'the-look' ? F.turnRate * 0.55 : F.turnRate) * dt);
        yaw += (gy - yaw) * k;
        pitch += (gp - pitch) * k;
        if (posePatch) {
          posePatch(obj, { expression, head: [yaw, pitch, 0], headYaw: yaw, headPitch: pitch });
        } else if (head && headRest) {
          head.quaternion.copy(headRest).multiply(tq.setFromAxisAngle(Y, yaw)).multiply(tq2.setFromAxisAngle(X, -pitch));
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const tq2 = new Quaternion();
