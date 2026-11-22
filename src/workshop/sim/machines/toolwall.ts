/**
 * The tool wall (P4 T2; REWRITE.md § C "Tool wall", § D 9, § B1 law 1). Eight tools hang on a pegboard on the back
 * wall, each over its painted shadow. Each tool is a loose part (kind `tool`) like any other: it is taken down, carried,
 * thrown, set on the belt, struck, painted on the platen, shipped and sent back up the chute. This unit is the wall:
 * what holds a tool on its peg, takes it back when it is hung up again, and the sheet pinned beside them.
 *
 * - **Hanging**, a tool is in the wall's custody (mode `machine`: a kinematic body on its peg, as a thing lies on its
 *   crate's tray, sim/machines/crates.ts): not asleep in the physics and not knocked off by anything thrown at it (the
 *   wall is a wall: a crate thrown at the board bounces off the tools and the board and falls to the bench). Its
 *   durable location is `in` the wall (`{ at: 'in', station, mouth: <this unit's id> }`): every tool starts there
 *   (`PartSpec.stowedIn` this unit), and is hung on its peg in the first step.
 * - **Taken**: the visitor's hand takes it off the peg like any part (the world tells the wall: `lost(part, 'grab')`);
 *   the wall says so (`toolwall.taken`: the peg's click). Its location stays `in` the wall until it comes to rest
 *   somewhere else (§ E5: being held is motion, not a location).
 * - **Hung back**: a tool free near its OWN place (its centre within `catchReach` of where it hangs, in the board's
 *   plane, and no farther out from the board than `catchDepth`) and slower than `catchSpeed` is taken back: let go
 *   there, set there by tap-then-tap or the keys (each tool's place is a mouth of the scene, `peg-<kind>`: `place`
 *   puts the tool at it), or thrown at it gently. It glides onto its peg (`easeSeconds`) and its location is written
 *   `in` the wall, charged as a machine's effect on a part is (§ E5 rule 4: to whoever last placed it). Faster, it
 *   bounces off the board and lies on the bench. Another tool's place does not take it: it drops (`toolwall.missed`).
 * - **Undo and reset**: a location restored to `in` the wall hangs the tool again at once (`restored`), from wherever
 *   it was (the view draws the hop); a tool that cannot be taken yet (in a crew member's hands) hangs as soon as it is
 *   free. "Reset the workshop" therefore hangs all eight, bare (their colour's start).
 * - **The sheet** (`spec.sheet`), pinned to the board: pressed, it asks the page for the full skills list
 *   (`toolwall.sheet`). Nothing durable.
 * - **Look**: a double-click or double-tap on a tool (`select`) asks for the camera (crates.ts "Asking for the
 *   camera"): a hanging tool asks for the board, a tool out on the bench for itself.
 *
 * Fetch and Revert never learn about tools (they read crates only); nothing here asks them anything.
 */
import type { Cause, Id, Intent, Outcome, Pose, Quat, Restore, SimEvent, StationId, ToolwallView, Vec3 } from '../types.ts';
import type { LostReason, MachineUnit, SimContext } from '../context.ts';
import type { UnitFactory } from '../scene.ts';
import type { Job } from '../history.ts';
import { HZ, steps } from '../clock.ts';
import { Beat, OK } from '../machine.ts';
import { qmul, rotate } from '../math.ts';

/** Tune here. Units, units per second, seconds. */
export const TOOLWALL_TUNING = {
  /**
   * A tool is carried as it hangs, its length upright (the world carries a part level); set down still it would stand
   * on its end, which no hammer does. One standing (its length within `standDeg` of upright) and nearly still topples
   * where it stands: the wall takes it for `topple` seconds and lays it on its back across the bench (its length along
   * x, its good side up, its middle over the spot it stood on, falling faster as it goes), then lets go of it still,
   * charged to whoever set it down: it rests there, or a mouth there takes it (the belt, the platen's tray).
   */
  standDeg: 28,
  stillSpeed: 0.35,
  topple: 0.32,
  /** How near its own place (in the board's plane, from where its middle hangs) a tool must be to be taken back. */
  catchReach: 0.55,
  /** And how far out from where it hangs (toward the visitor) at most. */
  catchDepth: 2.2,
  /** And no faster than this (a gentle throw catches; a hard one bounces off the board). */
  catchSpeed: 4.0,
  /** The glide onto the peg. */
  easeSeconds: 0.14,
  /**
   * A tool shipped comes back up the chute after the dock's `returnAfter.tool` (6 s). If nothing has brought it back after
   * this long (an undo took back the action its return was part of while it flew, and put it back as shipped: the dock
   * queues no return for a part restored from shipped to shipped), the wall sends it up the chute itself, as the system.
   */
  stranded: 14,
} as const;

export interface ToolwallTool {
  /** The tool's part id. */
  readonly id: Id;
  /** Its place: a mouth of the scene (tap-then-tap and the keys put it there). */
  readonly peg: Id;
  /** Where its body's middle hangs, and how it is turned there (world). */
  readonly hang: Pose;
  /** What a look at it asks for when it is out on the bench (a pick target the view registers that is never pressed). */
  readonly look: Id;
}

export interface ToolwallSpec {
  readonly id: Id;
  readonly station: StationId;
  readonly name: string;
  readonly tools: readonly ToolwallTool[];
  readonly sheet: { readonly id: Id; readonly name: string };
  /** What a look at a hanging tool asks for: the board (a pick target the view registers that is never pressed). */
  readonly look: Id;
  /** The way the visitor looks at the bench (unit, toward them): a tool is over its place where it covers it on the screen. */
  readonly sight?: Vec3;
}

export interface ToolwallUnit extends MachineUnit {
  view(): ToolwallView;
}

export function toolwall(spec: ToolwallSpec): UnitFactory {
  return (ctx) => createToolwall(ctx, spec);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function nlerp(a: Quat, b: Quat, t: number): Quat {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
  const q: Quat = [lerp(a[0], s * b[0], t), lerp(a[1], s * b[1], t), lerp(a[2], s * b[2], t), lerp(a[3], s * b[3], t)];
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function createToolwall(ctx: SimContext, spec: ToolwallSpec): ToolwallUnit {
  const T = TOOLWALL_TUNING;
  const beat = new Beat(ctx);
  const byId = new Map(spec.tools.map((t) => [t.id, t]));
  for (const t of spec.tools) {
    const p = ctx.scene.parts.find((x) => x.id === t.id);
    if (!p || p.kind !== 'tool' || p.stowedIn !== spec.id) throw new Error(`toolwall: ${t.id} is not a tool of this scene that starts on the wall (stowedIn ${spec.id})`);
  }
  ctx.register({
    id: spec.sheet.id,
    station: spec.station,
    name: spec.sheet.name,
    affordances: ['press'],
    tell: () => ctx.emit({ type: 'tell', id: spec.sheet.id }),
    misfire: (level) => ctx.emit({ type: 'misfire', id: spec.sheet.id, level }),
  });

  /** Tools on their pegs (the wall holds them), and the glide of one going back on (its start, from where). */
  const hung = new Set<Id>();
  const easing = new Map<Id, { from: Pose; at: number }>();
  /** When each tool last came off or went on (step), for the view. */
  const changed = new Map<Id, number>();
  /** Tools an undo or a reset put back on the wall that could not be taken yet (a crew member had them): hung when free. */
  const pending = new Set<Id>();
  /** Tools let go at another's place, already said (once a flight: until the tool lies still, or hangs). */
  const missed = new Set<Id>();
  /** Tools that came at their own place too fast this flight: they bounced off the board, and are not taken back until they lie still. */
  const bounced = new Set<Id>();
  let started = false;
  let resetting = false;
  /** Tools shipped and still behind the dock's door: since when (step). */
  const stranded = new Map<Id, number>();

  const onWall = (id: Id): boolean => {
    const l = ctx.part(id)?.location;
    return !!l && l.at === 'in' && l.mouth === spec.id;
  };

  /** Hang it on its peg now (or glide it there from where it is), in the wall's custody. False if it is not free to take. */
  function hang(id: Id, glide: boolean, how: 'hand' | 'undo' | 'reset' | null): boolean {
    const t = byId.get(id)!;
    const m = ctx.mode(id);
    if (m === 'gone' || m === 'chute') ctx.launch(id, t.hang, [0, 0, 0], [0, 0, 0], null);
    else if (m !== 'free') return m === 'machine' && hung.has(id);
    if (!ctx.take(id, spec.id)) return false;
    hung.add(id);
    pending.delete(id);
    missed.delete(id);
    bounced.delete(id);
    changed.set(id, ctx.clock.step);
    const from = ctx.pose(id);
    if (glide && from) {
      easing.set(id, { from, at: ctx.clock.step });
      ctx.drive(id, from, true);
    } else {
      easing.delete(id);
      ctx.drive(id, t.hang, true);
    }
    if (how) ctx.emit({ type: 'toolwall.hung', id: spec.id, tool: id, how });
    if (how === 'hand') ctx.emit({ type: 'handle.worked', id }); // the peg's click
    return true;
  }

  /** Where a tool is from its own place: in the board's plane, and out from it toward the visitor. */
  function offset(p: Vec3, t: ToolwallTool): { plane: number; out: number } {
    const h = t.hang.p;
    const out = p[2] - h[2];
    // over its place as the visitor sees it: slid back along the eye's line to the board's plane (a tool the hand holds up
    // the wall is carried short of the board, and is over its shadow on the screen, not in the world)
    const s = spec.sight;
    const k = s && out > 0 && s[2] > 1e-3 ? out / s[2] : 0;
    return { plane: Math.hypot(p[0] - (s?.[0] ?? 0) * k - h[0], p[1] - (s?.[1] ?? 0) * k - h[1]), out };
  }

  /** Let go at its own place, slowly enough: it goes back on (its location written by whoever last placed it). */
  function tryCatch(t: ToolwallTool): void {
    const pose = ctx.pose(t.id);
    const v = ctx.velocity(t.id);
    if (!pose || !v) return;
    const near = (o: { plane: number; out: number }): boolean => o.plane <= T.catchReach && o.out <= T.catchDepth && o.out >= -0.4;
    const slow = Math.hypot(...v.linvel) <= T.catchSpeed;
    if (ctx.settled(t.id)) {
      missed.delete(t.id);
      bounced.delete(t.id);
    }
    if (near(offset(pose.p, t))) {
      if (!slow) bounced.add(t.id);
      if (!slow || bounced.has(t.id)) return;
      let cause: Cause = ctx.history.chargeMachine(t.id);
      if (cause === 'crew') cause = 'system';
      if (!onWall(t.id)) {
        const loc = { at: 'in' as const, station: spec.station, mouth: spec.id };
        const r = ctx.commit([{ target: t.id, field: 'location', after: loc }], cause);
        if (r.refused.length > 0) ctx.commit([{ target: t.id, field: 'location', after: loc }], 'system');
      }
      hang(t.id, true, 'hand');
      return;
    }
    // at another tool's place: not its place (said once, as it drops)
    for (const o of spec.tools) {
      if (o.id === t.id || !near(offset(pose.p, o))) continue;
      if (slow && !missed.has(t.id)) {
        missed.add(t.id);
        ctx.emit({ type: 'toolwall.missed', id: spec.id, tool: t.id, peg: o.id });
      }
      return;
    }
  }

  /** Standing on its end and nearly still (set down as it was carried): it topples where it stands (`TOOLWALL_TUNING.topple`). */
  const cosStand = Math.cos((T.standDeg * Math.PI) / 180);
  /** A tool lying on its back across the bench (length along x, good side up): body +Y to world +X, +Z to +Y, +X to +Z. */
  const LYING: Quat = [0.5, 0.5, 0.5, 0.5];
  function toppleIfStanding(id: Id): void {
    const pose = ctx.pose(id);
    const v = ctx.velocity(id);
    const half = ctx.halfExtents(id);
    if (!pose || !v || !half) return;
    const up = rotate(pose.q, [0, 1, 0]);
    if (up[1] < cosStand || Math.hypot(...v.linvel) > T.stillSpeed || Math.hypot(...v.angvel) > 1.5) return;
    let cause: Cause = ctx.history.chargeMachine(id);
    if (cause === 'crew') cause = 'system';
    if (!ctx.take(id, spec.id)) return;
    // its yaw kept: it falls toward its own right, onto its back
    const f = rotate(pose.q, [0, 0, 1]);
    const yaw = Math.atan2(f[0], f[2]);
    const qy: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    const to: Pose = { p: [pose.p[0], pose.p[1] - half[1] * up[1] + half[2] + 0.004, pose.p[2]], q: qmul(qy, LYING) };
    // (taken out of the hand's window, the setting down must not leave the stack before it rests: work under it keeps it)
    const job = ctx.history.work(cause, spec.id, () => laying.delete(id));
    laying.set(id, { from: pose, to, at: ctx.clock.step, cause, job });
  }
  /** Tools toppling (the wall has them for a moment): from, to, when, whose rest it is, and the work that keeps that open. */
  const laying = new Map<Id, { from: Pose; to: Pose; at: number; cause: Cause; job: Job }>();
  /** A toppled tool let go: its work is done once it has come to rest (and its rest is charged), or after a while. */
  let finishing: { job: Job; id: Id; until: number }[] = [];
  function lay(id: Id): void {
    const l = laying.get(id)!;
    const k = Math.min(1, (ctx.clock.step - l.at) / Math.max(1, steps(T.topple)));
    const s = k * k; // falling: faster as it goes
    ctx.drive(id, { p: [lerp(l.from.p[0], l.to.p[0], s), lerp(l.from.p[1], l.to.p[1], s), lerp(l.from.p[2], l.to.p[2], s)], q: nlerp(l.from.q, l.to.q, s) });
    if (k < 1) return;
    laying.delete(id);
    ctx.release(id, [0, 0, 0], [0, 0, 0], l.job.active ? l.cause : 'system');
    finishing.push({ job: l.job, id, until: ctx.clock.step + steps(3) });
    ctx.emit({ type: 'part.hit', id, other: null, strength: 0.25 });
  }

  const lookAt = (id: Id): boolean => {
    const t = byId.get(id);
    if (!t) return false;
    const m = ctx.mode(id);
    if (m === 'gone' || m === 'chute' || m === undefined) return false;
    ctx.emit({ type: 'look', target: hung.has(id) ? spec.look : t.look });
    return true;
  };

  const unit: ToolwallUnit = {
    id: spec.id,
    station: spec.station,
    name: spec.name,
    // (the tools are their own registry entries, as parts; the sheet is one; the wall itself is pressed for nothing)
    affordances: [],
    tell() {
      ctx.emit({ type: 'tell', id: spec.sheet.id });
    },
    misfire(level) {
      beat.hit(level);
      ctx.emit({ type: 'misfire', id: spec.id, level });
    },

    intent(intent: Intent): boolean {
      if (ctx.bracketed) return false;
      if (intent.type === 'select') {
        if (intent.id === spec.sheet.id) {
          ctx.emit({ type: 'look', target: spec.look });
          return true;
        }
        return lookAt(intent.id);
      }
      if (intent.type === 'press' && intent.id === spec.sheet.id) {
        ctx.emit({ type: 'handle.worked', id: spec.sheet.id });
        ctx.emit({ type: 'toolwall.sheet', id: spec.id, sheet: spec.sheet.id });
        return true;
      }
      return false;
    },

    pre() {
      if (ctx.bracketed) return;
      finishing = finishing.filter((f) => {
        const over = ctx.clock.step > f.until || ctx.mode(f.id) !== 'free' || ctx.settled(f.id);
        if (over) f.job.done();
        return !over;
      });
      if (!started) {
        // every tool starts on the wall: hung in the first step
        started = true;
        for (const t of spec.tools) if (onWall(t.id)) hang(t.id, false, null);
      }
      for (const t of spec.tools) {
        const m = ctx.mode(t.id);
        if (hung.has(t.id)) {
          if (m !== 'machine') {
            hung.delete(t.id);
            easing.delete(t.id);
            continue;
          }
          const e = easing.get(t.id);
          if (!e) continue;
          const k = Math.min(1, (ctx.clock.step - e.at) / Math.max(1, steps(T.easeSeconds)));
          const s = k * k * (3 - 2 * k);
          const h = t.hang;
          ctx.drive(t.id, { p: [lerp(e.from.p[0], h.p[0], s), lerp(e.from.p[1], h.p[1], s), lerp(e.from.p[2], h.p[2], s)], q: nlerp(e.from.q, h.q, s) });
          if (k >= 1) easing.delete(t.id);
          continue;
        }
        if (pending.has(t.id)) {
          if (!onWall(t.id)) pending.delete(t.id);
          else if (m === 'free' || m === 'gone' || m === 'chute') hang(t.id, false, 'undo');
          continue;
        }
        if (laying.has(t.id)) {
          if (m === 'machine') lay(t.id);
          else laying.delete(t.id);
          continue;
        }
        // shipped, and nobody bringing it back (the dock's return for it was taken back with an undo): up the chute after a while
        if (m === 'gone' && ctx.part(t.id)?.location.at === 'shipped') {
          const since = stranded.get(t.id) ?? ctx.clock.step;
          stranded.set(t.id, since);
          if (ctx.clock.step - since > steps(T.stranded)) {
            stranded.delete(t.id);
            ctx.toChute(t.id, 'system');
          }
          continue;
        }
        stranded.delete(t.id);
        if (m === 'held') {
          missed.delete(t.id);
          bounced.delete(t.id);
        }
        if (m === 'free') {
          tryCatch(t);
          if (!hung.has(t.id)) toppleIfStanding(t.id);
        }
      }
    },

    lost(part: Id, why: LostReason) {
      if (!byId.has(part)) return;
      const wasHung = hung.has(part);
      hung.delete(part);
      laying.get(part)?.job.done();
      laying.delete(part);
      easing.delete(part);
      changed.set(part, ctx.clock.step);
      if (why === 'grab' && wasHung) {
        ctx.emit({ type: 'toolwall.taken', id: spec.id, tool: part });
        ctx.emit({ type: 'handle.worked', id: part }); // the peg's click
      }
    },

    restored(restores: readonly Restore[]) {
      // an undo or a reset put a tool's location back `in` the wall: it hangs again, at once, from wherever it was
      const all = resetting;
      resetting = false;
      const how = all ? 'reset' : 'undo';
      for (const t of spec.tools) {
        const named = restores.some((r) => r.target === t.id && r.field === 'location');
        if (!all && !named) continue;
        if (!onWall(t.id)) continue;
        if (ctx.mode(t.id) === 'held') continue; // in the visitor's hand: it stays there (it goes back on when let go at its place)
        if (hung.has(t.id) && ctx.mode(t.id) === 'machine') {
          // already on its peg (a reset that found it there): back to its place exactly
          easing.delete(t.id);
          ctx.drive(t.id, t.hang, true);
          continue;
        }
        if (!hang(t.id, false, how)) pending.add(t.id);
      }
    },

    reset() {
      resetting = true;
      missed.clear();
      bounced.clear();
      stranded.clear();
      pending.clear();
      for (const l of laying.values()) l.job.done();
      laying.clear();
      for (const f of finishing) f.job.done();
      finishing = [];
      beat.reset();
    },

    heard(events: readonly SimEvent[]) {
      void events;
    },

    // a part that comes to rest in a tool's place (nothing does: a tool there is taken first, anything else falls) rests where it lies
    accept: (): Outcome => OK,
    abort() {},

    view(): ToolwallView {
      const now = ctx.clock.step;
      return {
        kind: 'toolwall',
        id: spec.id,
        station: spec.station,
        lamp: 'dark',
        misfire: beat.view(),
        sheet: spec.sheet.id,
        tools: spec.tools.map((t) => {
          const c = changed.get(t.id);
          const e = easing.get(t.id);
          return { id: t.id, hung: hung.has(t.id), since: c === undefined ? Infinity : (now - c) / HZ, easing: e ? Math.min(1, (now - e.at) / Math.max(1, steps(T.easeSeconds))) : null };
        }),
      };
    },
  };
  return unit;
}
