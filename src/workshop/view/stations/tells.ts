/**
 * Tells a visitor can see (T1; REWRITE.md § B3 "the lamp of the nearest untouched station blinks slowly; later its
 * lid rattles", § B1 "A station's own lamp is dark when idle, steady while its verb is running, and blinks slowly
 * as a tell"). One view for the ten stations of the Button's ladder; it draws nothing of its own but light and a
 * shiver:
 *
 *  - **The glow.** Each station draws its own lamp (its lit/unlit bulb twin, switched by `lampOn`,
 *    `station-lamp.ts`). This view adds the lamp's light on what is beside it: a soft warm glow round every lit
 *    station lamp, following the lamp's level (`lampLevel`), so a blink swells and fades instead of snapping, and
 *    a lamp a few pixels across still changes enough of the picture to draw the eye from across the bench. All
 *    glows are one mesh and one draw call (`view/effects/lamp-halos.ts`), none while nothing is lit; no light.
 *  - **The rattle.** The second time round for a station (`TellsView.last.times > 1`) one of its own moving parts
 *    rattles for a moment a third of a second into the tell, as if something inside wanted out: a short burst of
 *    knocks that die away (`RATTLE`, the same knocks the `tell.rattle` sound plays). View only: no simulated
 *    state moves. Not while that station's verb is running; it stops the moment the station is used (its lamp
 *    leaves the blink, or any event of that station arrives); never with reduced motion (the lamp still blinks).
 *
 * Which lamp and which part, per station: `TELL_PARTS`. A part is found by its node name under the station's
 * root (a bone of a skinned piece, or a group): the station poses it as before, and the rattle is laid over
 * whatever pose it was given this frame, then taken off again.
 */
import { Quaternion, Vector3, type Material, type Object3D, type PerspectiveCamera } from 'three';
import type { Id, LampState, MachineView, SimEvent, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { LampHalos } from '../effects/lamp-halos.ts';
import { lampLevel } from './station-lamp.ts';
import { TELL_SECONDS } from '../../sim/index.ts';

/**
 * The rattle's knocks: seconds after the tell, and each one's strength (0..1). The `tell.rattle` sound
 * (audio/voices.ts) is drawn from the same list (tests/unit/view/tells.test.ts holds the two together).
 */
export const RATTLE = {
  start: 0.35,
  knocks: [
    [0, 1],
    [0.075, 0.75],
    [0.14, 0.9],
    [0.22, 0.6],
    [0.29, 0.45],
    [0.38, 0.25],
  ] as readonly (readonly [number, number])[],
  /** Each knock rings at this rate (Hz) and dies with this time constant (s). */
  ring: 26,
  tau: 0.03,
} as const;

/** How long the rattle lasts after its start, seconds. */
export const RATTLE_SECONDS = RATTLE.knocks[RATTLE.knocks.length - 1]![0] + 6 * RATTLE.tau;

/** The rattle's shake at `s` seconds after its start: about -1..1. */
export function rattleAt(s: number): number {
  let x = 0;
  for (const [t, a] of RATTLE.knocks) {
    const d = s - t;
    if (d < 0) continue;
    x += a * Math.exp(-d / RATTLE.tau) * Math.sin(2 * Math.PI * RATTLE.ring * d);
  }
  return x;
}

export interface TellPart {
  /** The station view's root object name. */
  readonly root: string;
  /** The lamp's lit bulb node under it (its position is where the glow sits). */
  readonly lamp: string;
  /** The glow's radius: world units, and at least this many CSS px on screen. */
  readonly glow: number;
  readonly glowPx: number;
  /** The part that rattles: a node under the root, the axis it shivers about (its own frame), how far (degrees), and a lift along its own +Y (units). */
  readonly rattle: { readonly node: string; readonly axis: readonly [number, number, number]; readonly deg: number; readonly lift: number };
  /** Is the station's verb running now (no rattle over it; for the lamps this view decides: steady)? */
  readonly running: (w: WorldView, m: MachineView | undefined) => boolean;
}

const v = <K extends MachineView['kind']>(m: MachineView | undefined, kind: K): Extract<MachineView, { kind: K }> | null =>
  m && m.kind === kind ? (m as Extract<MachineView, { kind: K }>) : null;

/** The ten stations: which lamp glows, which part rattles. */
export const TELL_PARTS: Readonly<Record<Id, TellPart>> = {
  'undo-lever': {
    root: 'undo-station',
    lamp: 'lamp.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'lever', axis: [0, 1, 0], deg: 2.5, lift: 0 },
    running: (_w, m) => (v(m, 'undo-lever')?.phase ?? 'rest') !== 'rest',
  },
  striker: {
    root: 'striker',
    lamp: 'lamp.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'arm', axis: [1, 0, 0], deg: 5, lift: 0 },
    running: (_w, m) => {
      const s = v(m, 'striker');
      return !!s && (s.cock > 0 || s.since < 0.5);
    },
  },
  cord: {
    root: 'switchboard',
    lamp: 'lamp.cord.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'plug', axis: [1, 0, 0], deg: 7, lift: 0.02 },
    running: (w) => !!w.cord('cord')?.lifted,
  },
  belt: {
    root: 'belt',
    lamp: 'lamp.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'lever', axis: [0, 0, 1], deg: 9, lift: 0 },
    running: (_w, m) => !!v(m, 'belt')?.running,
  },
  dock: {
    root: 'dock',
    lamp: 'lamp.lit',
    glow: 0.26,
    glowPx: 22,
    rattle: { node: 'flap', axis: [1, 0, 0], deg: 10, lift: 0 },
    running: (_w, m) => {
      const d = v(m, 'dock');
      return !!d && (d.door > 0 || d.shipping.length > 0);
    },
  },
  chute: {
    root: 'chute',
    lamp: 'lamp.lit',
    glow: 0.26,
    glowPx: 22,
    rattle: { node: 'chute.hinge', axis: [1, 0, 0], deg: 1.4, lift: 0.012 },
    running: (_w, m) => {
      const c = v(m, 'chute');
      return !!c && (c.waiting > 0 || c.flap < 0.8);
    },
  },
  lamp: {
    root: 'lamp',
    lamp: 'pilot.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'head', axis: [1, 0, 0], deg: 4, lift: 0 },
    running: (_w, m) => !!v(m, 'lamp')?.dragging,
  },
  line: {
    root: 'phone',
    lamp: 'lamp.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'phone', axis: [0, 0, 1], deg: 4, lift: 0.012 },
    running: (_w, m) => {
      const l = v(m, 'line');
      return !!l && (l.ringing !== null || l.waiting > 0 || l.job !== null);
    },
  },
  platen: {
    root: 'platen',
    lamp: 'lamp.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'tray', axis: [1, 0, 0], deg: 3, lift: 0.015 },
    running: (w) => w.machine('line')?.kind === 'line' && (w.machine('line') as Extract<MachineView, { kind: 'line' }>).job?.station === 'platen',
  },
  storefront: {
    root: 'storefront',
    lamp: 'lamp.lit',
    glow: 0.24,
    glowPx: 22,
    rattle: { node: 'opensign', axis: [0, 0, 1], deg: 14, lift: 0 },
    running: (w) => w.machine('line')?.kind === 'line' && (w.machine('line') as Extract<MachineView, { kind: 'line' }>).job?.station === 'storefront',
  },
};

/**
 * The lamp state a station shows: its machine's (`MachineView.lamp`), except for the two stations whose lamp the
 * simulation does not run all of: the cord (no machine: its tell is an event, and the view keeps the eight seconds
 * until the plug is touched) and the chute (the simulation blinks it; steady while a part is on its way up is
 * drawn here, so the opening's state is unchanged).
 */
export class StationLamps {
  #cordUntil = -Infinity;
  /** Feed a frame's events (once per frame, before `state`). */
  heard(events: readonly SimEvent[], t: number): void {
    for (const e of events) {
      if (e.type === 'tell' && e.id === 'cord') this.#cordUntil = t + TELL_SECONDS;
      if ((e.type === 'cord.unplugged' || e.type === 'cord.plugged') && e.cord === 'cord') this.#cordUntil = -Infinity;
      if (e.type === 'reset') this.#cordUntil = -Infinity;
    }
  }
  state(w: WorldView, id: Id, t: number): LampState {
    if (id === 'cord') {
      const c = w.cord('cord');
      if (c?.lifted) this.#cordUntil = -Infinity;
      return t < this.#cordUntil ? 'blink' : c?.lifted ? 'steady' : 'dark';
    }
    const m = w.machine(id);
    const s = m?.lamp ?? 'dark';
    if (id === 'chute' && s === 'dark' && TELL_PARTS['chute']!.running(w, m)) return 'steady';
    return s;
  }
}

/**
 * P4 P1a: a glow of another view's own (a crew member's running lamps), drawn in the tells' one halo mesh: a view whose
 * root (a child of the scene) carries `userData.halos = source` is asked each frame, after the station lamps, to `add`
 * its glows (world point, radius in units, at least this many CSS px, level 0..1). At most `EXTRA_HALOS` of them.
 */
export type HaloSource = (add: (at: Vector3, r: number, minPx: number, level: number) => void) => void;
export const EXTRA_HALOS = 6;

/** One station's rattle in flight. */
interface Shiver {
  id: Id;
  /** Simulation time it starts. */
  at: number;
  node: Object3D | null;
  base: { p: Vector3; q: Quaternion } | null;
  applied: { p: Vector3; q: Quaternion } | null;
}

export function createTellsView(): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const camera = (ctx.stage.camera as unknown as { camera: PerspectiveCamera }).camera;
    const halos = new LampHalos(ctx.materials as unknown as { halo?: () => Material }, Object.keys(TELL_PARTS).length + EXTRA_HALOS);
    ctx.scene.add(halos.mesh);
    const lamps = new StationLamps();
    const lampNode = new Map<Id, Object3D | null>();
    const p = new Vector3();
    const q = new Quaternion();
    const axis = new Vector3();
    let shiver: Shiver | null = null;
    let lastTell = -1;

    const find = (id: Id, name: string): Object3D | null => {
      const spec = TELL_PARTS[id]!;
      let root: Object3D | undefined;
      for (const c of ctx.scene.children) if (c.name === spec.root) root = c;
      return root?.getObjectByName(name) ?? null;
    };

    /** Take the rattle off its part (back to the pose the station gave it). */
    const settle = (s: Shiver): void => {
      if (s.node && s.base && s.applied && s.node.position.equals(s.applied.p) && s.node.quaternion.equals(s.applied.q)) {
        s.node.position.copy(s.base.p);
        s.node.quaternion.copy(s.base.q);
      }
    };

    const usedBy = (e: SimEvent, id: Id): boolean => {
      if (e.type === 'tell') return false;
      if ((e as { cord?: unknown }).cord === id) return true;
      const eid = (e as { id?: unknown }).id;
      return typeof eid === 'string' && (eid === id || eid.startsWith(`${id}-`) || (id === 'cord' && eid.startsWith('jack-')));
    };

    return {
      root: halos.mesh,
      update(frame: Frame) {
        const w = frame.world;
        const t = frame.time;
        lamps.heard(frame.events, t);

        // ── the glows ──
        camera.updateMatrixWorld();
        const H = Math.max(1, (globalThis as { innerHeight?: number }).innerHeight ?? 900);
        halos.begin(camera, H);
        for (const id of Object.keys(TELL_PARTS)) {
          const spec = TELL_PARTS[id]!;
          const level = lampLevel(lamps.state(w, id, t), t);
          if (level <= 0.002) continue;
          let n = lampNode.get(id);
          if (!n) {
            n = find(id, spec.lamp);
            if (n) lampNode.set(id, n);
          }
          if (!n || !n.visible) continue;
          n.updateWorldMatrix(true, false);
          p.setFromMatrixPosition(n.matrixWorld);
          halos.add(p, spec.glow, spec.glowPx, level);
        }
        // (P4 P1a) any other view's own glows, through the same mesh: a crew member's lamps (`HaloSource`)
        for (const c of ctx.scene.children) (c.userData['halos'] as HaloSource | undefined)?.((at, r, px, level) => halos.add(at, r, px, level));
        halos.end();

        // ── the rattle ──
        const last = w.tells().last;
        if (last && last.step !== lastTell) {
          lastTell = last.step;
          if (shiver) settle(shiver);
          shiver = null;
          if (last.times > 1 && !w.reducedMotion && TELL_PARTS[last.id]) {
            shiver = { id: last.id, at: last.step / 60 + RATTLE.start, node: null, base: null, applied: null };
          }
        }
        if (!shiver) return;
        const s = shiver;
        const spec = TELL_PARTS[s.id]!;
        const m = w.machine(s.id);
        const over =
          w.reducedMotion ||
          t > s.at + RATTLE_SECONDS ||
          lamps.state(w, s.id, t) !== 'blink' ||
          frame.events.some((e) => usedBy(e, s.id)) ||
          (t >= s.at && !s.applied && spec.running(w, m));
        if (over) {
          settle(s);
          shiver = null;
          return;
        }
        if (t < s.at) return;
        s.node ??= find(s.id, spec.rattle.node);
        const node = s.node;
        if (!node) return;
        // the pose the station gave it this frame: what it shows now, unless that is still our own
        if (!s.applied || !node.position.equals(s.applied.p) || !node.quaternion.equals(s.applied.q)) s.base = { p: node.position.clone(), q: node.quaternion.clone() };
        const base = s.base!;
        const x = rattleAt(t - s.at);
        axis.set(...spec.rattle.axis).normalize();
        q.setFromAxisAngle(axis, (x * spec.rattle.deg * Math.PI) / 180);
        node.quaternion.copy(base.q).multiply(q);
        // a lift along its own up, only ever up (it knocks against its seat)
        p.set(0, Math.abs(x) * spec.rattle.lift, 0).applyQuaternion(base.q);
        node.position.copy(base.p).add(p);
        s.applied = { p: node.position.clone(), q: node.quaternion.clone() };
      },
      dispose() {
        if (shiver) settle(shiver);
        ctx.scene.remove(halos.mesh);
        halos.dispose();
      },
    };
  };
}
