/**
 * The controls surface (REWRITE.md § B6 keyboard column, § E9): the same
 * intents the pointer produces, as plain calls, so a later keyboard path and
 * the HTML controls list can drive the world without a pointer. Carrying
 * never requires a drag: `grab` then `place` is the whole of it.
 *
 * P1 wires only U, Esc, the arrows and + / − (gesture.ts `key`); Tab
 * through a controls list, Enter to pick up and Enter to put down arrive
 * with the list itself and call this.
 */
import type { Id, Intent, Vec3, WorldView } from '../sim/types.ts';

export interface CameraControls {
  pan(dx: number, dz: number): void;
  zoom(factor: number): void;
  back(): void;
  /** Frame one interactable's station (a hook until stations can be framed). */
  frame(id: Id): void;
}

export interface Controls {
  hover(id: Id | null): void;
  press(id: Id): void;
  turn(id: Id, value: number): void;
  /** Pick a loose part up (by default at its centre). */
  grab(id: Id, grip?: Vec3): void;
  carry(target: Vec3): void;
  release(velocity?: Vec3): void;
  place(at: Id | Vec3): void;
  unplug(cord: Id): void;
  plug(cord: Id, jack: Id | null): void;
  /** The undo lever, when the world has one (`undoId`), pulled. */
  undo(): void;
  readonly camera: CameraControls;
}

export interface ControlsOptions {
  world: () => WorldView | null;
  dispatch(intent: Intent, t: number): void;
  camera: CameraControls;
  now?: () => number;
  /** The interactable the U key presses (the lever, when it arrives). */
  undoId?: Id | null;
}

export function createControls(o: ControlsOptions): Controls {
  const now = o.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : 0));
  const send = (i: Intent): void => o.dispatch(i, now());
  return {
    hover: (id) => send({ type: 'hover', id }),
    press: (id) => send({ type: 'press', id }),
    turn: (id, value) => send({ type: 'turn', id, value: Math.min(1, Math.max(0, value)) }),
    grab(id, grip) {
      const p = grip ?? o.world()?.motion(id)?.pose.p;
      if (p) send({ type: 'grab', id, grip: p });
    },
    carry: (target) => send({ type: 'carry', target }),
    release: (velocity = [0, 0, 0]) => send({ type: 'release', velocity }),
    place: (at) => send({ type: 'place', at }),
    unplug: (cord) => send({ type: 'unplug', cord }),
    plug: (cord, jack) => send({ type: 'plug', cord, jack }),
    undo() {
      const id = o.undoId ?? null;
      if (id && o.world()?.interactable(id)) send({ type: 'press', id });
    },
    camera: o.camera,
  };
}
