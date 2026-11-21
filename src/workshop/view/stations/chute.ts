/**
 * The return chute, alive (brief W1; REWRITE.md § B1 "the bench edge":
 * anything that falls off comes back up the return chute). The kit's
 * `chute` piece has no moving nodes: the whole duct jolts on its straps.
 *
 *  - on `flap` (a part pops out, or a misfire kicks with none) the duct
 *    takes a small sharp jolt about the strap on the apron: its mouth
 *    recoils down and back as the part leaves it, rings once or twice and
 *    settles; a little drop on the straps with it;
 *  - the part itself comes out of the throat in the line's parts overlay
 *    (`stations/line.ts`), along the mouth's axis, which this view posts on
 *    the line's bus.
 *
 * With reduced motion it stands still.
 *
 * T1: its station lamp (on the top of the run) is dark, steady while a part is on its way up or just out,
 * and blinks slowly as a tell (`StationLamps`, station-lamp.ts).
 */
import { Group, Matrix4, Vector3 } from 'three';
import type { Id } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { lineBus } from './line.ts';
import { lampOn } from './station-lamp.ts';
import { StationLamps } from './tells.ts';

/** Tune here. Angles in degrees, rates in rad/s. */
export const CHUTE_FEEL = {
  /** The jolt: its spring, and the kick a part (or a misfire) gives it (deg/s), per level of misfire. */
  omega: 34,
  zeta: 0.2,
  kick: 95,
  /** The drop on its straps (units/s kick) and that spring. */
  drop: 0.25,
  dropOmega: 48,
  dropZeta: 0.3,
} as const;

export interface ChuteViewOptions {
  /** The chute piece, built (with its stencil) and ready to place; null draws nothing. */
  piece: Piece | null;
  /** Where its origin stands. */
  at: readonly [number, number];
  machine?: Id;
}

function spring(o: { x: number; v: number }, omega: number, zeta: number, dt: number): void {
  let left = dt;
  const k = omega * omega, c = 2 * zeta * omega;
  while (left > 1e-6) {
    const h = Math.min(left, 1 / 240);
    o.v += (-k * o.x - c * o.v) * h;
    o.x += o.v * h;
    left -= h;
  }
}

export function createChuteView(o: ChuteViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const F = CHUTE_FEEL;
    const id = o.machine ?? 'chute';
    const bus = lineBus(ctx.scene);
    const root = new Group();
    root.name = 'chute';
    ctx.scene.add(root);
    if (!o.piece) return { root, update() {}, dispose: () => void root.removeFromParent() };
    const place = new Matrix4().makeTranslation(o.at[0], 0, o.at[1]);
    // the pivot: where the riser is strapped to the apron; the duct turns about the bench's X there
    const pivot = new Vector3();
    const ap = o.piece.sockets?.['apron'];
    if (ap) pivot.setFromMatrixPosition(ap).applyMatrix4(place);
    else pivot.set(o.at[0], -0.7, o.at[1]);
    const mouth = o.piece.sockets?.['mouth'];
    if (mouth) {
      const m = place.clone().multiply(mouth);
      bus.mouth = { p: new Vector3().setFromMatrixPosition(m), axis: new Vector3(0, 0, 1).transformDirection(m) };
    }
    // the pivot group sits at the strap; the piece hangs from it at its own place
    const hinge = new Group();
    hinge.name = 'chute.hinge';
    hinge.position.copy(pivot);
    root.add(hinge);
    const obj = ctx.realize(o.piece);
    obj.position.set(o.at[0] - pivot.x, -pivot.y, o.at[1] - pivot.z);
    hinge.add(obj);

    // T1: the station lamp (kit: `lamp.lit` / `lamp.unlit`), dark, steady while a part is on its way up, blinking as a tell
    const lit = obj.getObjectByName('lamp.lit'), unlit = obj.getObjectByName('lamp.unlit');
    const lamps = new StationLamps();
    let shown = -1;
    const jolt = { x: 0, v: 0 };
    const drop = { x: 0, v: 0 };
    let still = true;
    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const dt = Math.min(frame.dt, 0.1);
        lamps.heard(frame.events, frame.time);
        const on = lampOn(lamps.state(w, id, frame.time), frame.time) ? 1 : 0;
        if (on !== shown && lit && unlit) {
          lit.scale.setScalar(on ? 1 : 1e-4);
          unlit.scale.setScalar(on ? 1e-4 : 1);
          shown = on;
        }
        if (w.reducedMotion) {
          if (!still) {
            hinge.rotation.x = 0;
            hinge.position.y = pivot.y;
            jolt.x = jolt.v = drop.x = drop.v = 0;
            still = true;
          }
          return;
        }
        for (const e of frame.events) {
          if (e.type !== 'flap' || e.id !== id) continue;
          const m = w.machine(id);
          const level = e.part ? 1 : m?.misfire?.level ?? 1;
          // the mouth recoils (down and back toward the edge) as the part leaves it
          jolt.v -= F.kick * (e.part ? 1 : 0.7 * level);
          drop.v -= F.drop * (e.part ? 1 : 0.7 * level);
          still = false;
        }
        if (still) return;
        spring(jolt, F.omega, F.zeta, dt);
        spring(drop, F.dropOmega, F.dropZeta, dt);
        if (Math.abs(jolt.x) < 0.005 && Math.abs(jolt.v) < 0.05 && Math.abs(drop.x) < 1e-5 && Math.abs(drop.v) < 1e-4) {
          jolt.x = jolt.v = drop.x = drop.v = 0;
          still = true;
        }
        hinge.rotation.x = (jolt.x * Math.PI) / 180;
        hinge.position.y = pivot.y + drop.x;
      },
      dispose() {
        root.removeFromParent();
        bus.mouth = null;
      },
    };
  };
}
