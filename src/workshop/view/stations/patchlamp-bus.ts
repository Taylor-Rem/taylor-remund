/**
 * What the Patchlamp station's views share in one bench (W2): the realized
 * switchboard (Patch's paw opens its drawers: the operator view poses them),
 * the phone's box on screen and the boxes of the stations on each line (the
 * phone panel's `anchor` and `avoid`). View state only; nothing here is the
 * simulation's. One bus per key (the bench hands every station the same kit).
 */
import type { Object3D } from 'three';
import type { JackName } from '../kit/pieces/switchboard/index.ts';

export interface PatchlampBus {
  /** The realized switchboard (its drawers, lamps and collars), once the board's view is made. */
  board: Object3D | null;
  /** Pose the board's drawers (0 shut .. 1 out), from the operator's paw. */
  drawers: Record<JackName, number>;
  /** The station objects on each line, for the phone panel's `avoid` (world-space bounds are taken from them). */
  stations: Partial<Record<JackName, Object3D>>;
  /** The phone (its moving node), for the panel's `anchor`. */
  phone: Object3D | null;
}

const buses = new WeakMap<object, PatchlampBus>();

export function patchlampBus(key: object): PatchlampBus {
  let b = buses.get(key);
  if (!b) {
    b = { board: null, drawers: { storefront: 0, platen: 0, belt: 0, lamp: 0 }, stations: {}, phone: null };
    buses.set(key, b);
  }
  return b;
}

/** A scene jack id (`jack-storefront`) as the board's name for it, or null (a capped jack). */
export function jackName(id: string | null | undefined): JackName | null {
  const n = id?.replace(/^jack-/, '');
  return n === 'storefront' || n === 'platen' || n === 'belt' || n === 'lamp' ? n : null;
}
