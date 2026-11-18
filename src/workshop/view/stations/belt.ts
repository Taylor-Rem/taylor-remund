/**
 * The belt (REWRITE.md § B1 "The belt", § G P1 "a length of belt with
 * rollers", W4 brief § C): a length of conveyor whose surface scrolls and
 * whose rollers turn to match it exactly, so nothing skates. On a `misfire`
 * of the belt (Button rung 1, § B4 "the belt lurches back") it kicks
 * backwards, shudders and picks up again; while a rung rewinds it runs
 * backwards with everything else. On a world with a belt machine (the
 * bench), the machine's `phase` drives the surface instead: it carries parts
 * at that speed, so what rides it and the ribs under it move together.
 *
 * The surface speed is integrated here on the simulation clock (a damped
 * spring toward the running speed, kicked by a misfire), and the belt
 * material's scroll offset is set from it after `materials.update`, so a
 * lurch reads on the surface and the rollers alike. With reduced motion
 * the belt stands still (§ B10: "the belt and crew start still").
 */
import { Box3, Group, Quaternion, Vector3, type Object3D } from 'three';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import type { Piece } from '../kit/types.ts';
import { part, piece, pieceBounds, place, T } from '../kit/compose.ts';
import { roundedBox, lathe } from '../kit/solids.ts';
import { profile } from '../kit/profile.ts';
import { beltLoop } from '../kit/details.ts';
import { buildEntry, type Entry } from '../catalogue/registry.ts';
import type { Fit } from '../vignette.ts';
import { placedMatrix, splitStatic, type StaticPool } from './set.ts';
import { lampOn } from './line.ts';

/** Tune here. Speeds in units per simulation second. */
export const BELT_FEEL = {
  /** Running speed of the surface (left to right). */
  speed: 0.6,
  /** The spring that brings it back to speed: ω (rad/s) and damping ratio (under 1: a little overshoot). */
  omega: 7,
  damping: 0.55,
  /** A misfire: the surface is kicked to this speed (backwards). */
  lurch: -1.6,
  /** While a rung rewinds, the belt runs backwards at this fraction of its speed. */
  rewind: -1.8,
  /** Radius of the rollers, for matching their turn to the surface (the piece's own if it says). */
  rollerR: 0.075,
  /** The dial and the lever: half the pick box round each grip (units), the hover's lift and rate, the spring they follow
   * their setting through, and the kick a detent gives (setting units/s: a click past it and back). */
  pickHalf: 0.16,
  hoverLift: 0.018,
  hoverRate: 30,
  handleOmega: 30,
  handleZeta: 0.42,
  click: 2.2,
} as const;

export interface BeltViewOptions {
  entry: Entry | undefined;
  /** The belt piece's module: `poseBelt(root, length, rollers, { travel })` and `beltRollers(length)`. */
  module?: Record<string, unknown> | null;
  fit: Fit;
  seed: number;
  /** Hand the belt's body to the set to be merged (only the rollers, the seam and the lamp stay here). */
  pool?: StaticPool;
  /** The belt's length (its bed; default 6, the vignette's). */
  length?: number;
  /** More build options for the piece (the bench's belt: `{ line: true }`: controls, deflector, an open tail, stripes). */
  build?: Record<string, unknown>;
  /** The belt machine's id: when the world has it, its `BeltView.phase` scrolls the surface and turns the rollers (default 'belt'). */
  machine?: string;
  /** The dial's and the lever's interactable ids (default 'belt-dial', 'belt-lever'). */
  dialId?: string;
  leverId?: string;
}

interface Uniforms {
  u_offset?: { value: number | unknown };
  u_speed?: { value: number | unknown };
}

/** The stand-in: rails on legs round a real belt loop (so the scroll can be judged before the piece lands). */
function standInBelt(length: number): Piece {
  const b = piece('stand-in-belt', { ao: false });
  const top = 0.5, r = BELT_FEEL.rollerR, w = 0.62;
  b.add(place(beltLoop({ span: length - 0.3, r, width: w, thickness: 0.02 }), T(0, top - r, 0)));
  for (const z of [-1, 1]) b.add(place(part('paper', roundedBox({ w: length, h: 0.16, d: 0.06, r: 0.02 }), 'paper'), T(0, top - 0.06, z * (w / 2 + 0.05))));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(place(part('paper', roundedBox({ w: 0.1, h: top - 0.1, d: 0.1, r: 0.02 }), 'paper'), T(x * (length / 2 - 0.2), (top - 0.1) / 2, z * (w / 2 + 0.05))));
  // end rollers as nodes so the spin can be judged
  for (const [i, x] of [(-length / 2 + 0.15), (length / 2 - 0.15)].entries()) {
    const n = b.node(`roller${i}`, T(x, top - r, 0));
    n.add(place(part('metal', lathe(profile(r, -w / 2).to(r, w / 2, { fillet: 0.01 })), 'steel'), T(0, 0, 0)));
  }
  return b.build();
}

export function createBeltView(o: BeltViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const length = o.length ?? 6;
    const machineId = o.machine ?? 'belt';
    const whole = o.entry ? buildEntry(o.entry, null, { seed: o.seed, length, ...(o.build ?? {}) }, ctx.labels) : standInBelt(length);
    // the piece's own list of moving nodes when it exports one (BELT_MOVING), else the G1 belt's
    const movingRe = (o.module?.['BELT_MOVING'] as RegExp | undefined) ?? /^(roller\d+|seam|lamp)$/;
    const p = o.pool ? splitStatic(whole, placedMatrix(o.fit.belt.at), (n) => movingRe.test(n), o.pool) : whole;
    const obj = ctx.realize(p);
    const root = new Group();
    root.name = 'belt';
    root.applyMatrix4(placedMatrix(o.fit.belt.at));
    root.add(obj);
    ctx.scene.add(root);
    // the belt answers the pointer over its whole length (a proxy box: its body is merged into the set)
    const pb = pieceBounds(whole);
    ctx.pickable('belt', obj, { box: pb });
    // the dial and the lever: pick targets round their grips (generous invisible boxes; a finger needs 44 px)
    const handle = (sock: string, hid: string, node: string) => {
      const m = whole.sockets?.[sock];
      const o = obj.getObjectByName(node);
      if (!m || !o) return null;
      const g = new Group();
      g.name = `${hid}:pick`;
      g.applyMatrix4(m);
      obj.add(g);
      const r = BELT_FEEL.pickHalf;
      ctx.pickable(hid, g, { box: new Box3(new Vector3(-r, -r, -r), new Vector3(r, r, r)), pad: 0.02 });
      return { id: hid, o, p: o.position.clone(), q: o.quaternion.clone(), lift: 0, x: NaN, v: 0, last: NaN };
    };
    const dialH = handle('dial.grip', o.dialId ?? 'belt-dial', 'dial');
    const leverH = handle('lever.grip', o.leverId ?? 'belt-lever', 'lever');
    const up = new Vector3();
    /** The handle follows its setting through a spring (a detent's click: a kick past it and back) and lifts a hair on hover. */
    const follow = (h: NonNullable<typeof dialH>, value: number, frame: Frame, live: boolean, dt: number, reduced: boolean): number => {
      if (Number.isNaN(h.x)) h.x = h.last = value;
      if (value !== h.last) {
        if (!reduced) h.v += Math.sign(value - h.last) * BELT_FEEL.click;
        h.last = value;
      }
      let left = dt;
      const w = BELT_FEEL.handleOmega, z = reduced ? 1 : BELT_FEEL.handleZeta;
      while (left > 1e-6) {
        const st = Math.min(left, 1 / 240);
        h.v += (w * w * (value - h.x) - 2 * z * w * h.v) * st;
        h.x += h.v * st;
        left -= st;
      }
      if (Math.abs(h.x - value) < 1e-4 && Math.abs(h.v) < 1e-3) {
        h.x = value;
        h.v = 0;
      }
      const goal = live && frame.hovered === h.id ? BELT_FEEL.hoverLift : 0;
      h.lift += (goal - h.lift) * (1 - Math.exp(-BELT_FEEL.hoverRate * dt));
      return h.x;
    };
    const lifted = (h: typeof dialH): void => {
      if (!h) return;
      // stand proud along its own +Y (out of the desk)
      h.o.position.copy(up.set(0, h.lift, 0).applyQuaternion(h.q).add(h.p));
    };

    // rollers: roller0..n, turning about their local Z
    const rollers: Object3D[] = [];
    obj.traverse((n) => {
      if (/^roller\d+$/.test(n.name)) rollers.push(n);
    });
    const rest = rollers.map((r) => r.quaternion.clone());
    const rollerR = BELT_FEEL.rollerR;
    type PoseBelt = (root: Object3D, length: number, rollers: readonly unknown[], pose: { travel: number; dial?: number; lever?: number; lamp?: boolean }) => void;
    const poseBelt = o.entry ? ((o.module?.['poseBelt'] as PoseBelt | undefined) ?? null) : null;
    const beltRollers = o.module?.['beltRollers'] as ((length: number) => readonly unknown[]) | undefined;
    const rollerInfo = poseBelt && beltRollers ? beltRollers(length) : null;

    const uniforms = (): Uniforms | null => {
      const m = ctx.materials as unknown as { uniforms?: (cls: 'belt') => Uniforms };
      return m.uniforms ? m.uniforms('belt') : null;
    };
    const u = uniforms();
    if (u?.u_speed && typeof u.u_speed.value === 'number') u.u_speed.value = 0; // the offset is driven here

    const Z = new Vector3(0, 0, 1), spin = new Quaternion();
    let v = ctx.reducedMotion ? 0 : BELT_FEEL.speed;
    let dv = 0;
    let phase = 0;
    let angle = 0;
    return {
      root,
      update(frame: Frame) {
        ctx.materials.update(frame.time);
        const dt = Math.min(frame.dt, 0.1);
        // the simulation's belt, when there is one, says how far the surface has gone (it carries parts at that speed)
        const m = frame.world.machine(machineId);
        if (m?.kind === 'belt') {
          phase = m.phase;
          angle = -phase / rollerR;
          if (u?.u_offset) u.u_offset.value = phase;
          // one number drives the surface, the rollers, the seam and the stripes; the dial, the lever and the lamp show the settings
          const lever = m.running ? (m.direction === 'forward' ? 1 : -1) : 0;
          const live = !frame.world.bracketed;
          const reduced = frame.world.reducedMotion;
          const dial = dialH ? follow(dialH, m.speed, frame, live, dt, reduced) : m.speed;
          const lev = leverH ? follow(leverH, lever, frame, live, dt, reduced) : lever;
          if (poseBelt && rollerInfo) poseBelt(obj, length, rollerInfo, { travel: phase, dial: Math.max(0.6, Math.min(m.detents + 0.4, dial)), lever: lev, lamp: lampOn(m.lamp, frame.time) });
          else for (let i = 0; i < rollers.length; i++) rollers[i]!.quaternion.copy(rest[i]!).multiply(spin.setFromAxisAngle(Z, angle));
          lifted(dialH);
          lifted(leverH);
          return;
        }
        for (const e of frame.events) {
          if (e.type === 'misfire' && e.id === 'belt' && !ctx.reducedMotion) v = BELT_FEEL.lurch;
        }
        const b = frame.world.button();
        const goal = ctx.reducedMotion ? 0 : b.phase === 'rewinding' ? BELT_FEEL.speed * BELT_FEEL.rewind : BELT_FEEL.speed;
        // a damped spring toward the running speed, in small steps
        let left = dt;
        const w = BELT_FEEL.omega;
        while (left > 1e-6) {
          const h = Math.min(left, 1 / 240);
          dv += (-w * w * (v - goal) - 2 * BELT_FEEL.damping * w * dv) * h;
          v += dv * h;
          left -= h;
        }
        phase += v * dt;
        angle -= (v / rollerR) * dt;
        if (u?.u_offset) u.u_offset.value = phase;
        if (poseBelt && rollerInfo) {
          poseBelt(obj, length, rollerInfo, { travel: phase });
          return;
        }
        for (let i = 0; i < rollers.length; i++) {
          const r = rollers[i]!;
          r.quaternion.copy(rest[i]!);
          r.rotateZ(angle);
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
  };
}
