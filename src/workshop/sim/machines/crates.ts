/**
 * The project crates (P4 S5; REWRITE.md § B1 property table "contents: a latch on the lid", § D 10, § E5).
 * Six of the crates that circulate on the bench are Taylor's projects (`SceneDesc.projects`: crate id to project
 * id; the words are src/content/bench-projects.json's). Each has a brass latch on its lid, an interactable of its
 * own (`ProjectCrate.lid`): pressing it opens the crate, pressing again shuts it. Open, a paper card stands in it
 * with a brass plate (`ProjectCrate.plate`) that is the way to the project's entry on /resume/.
 *
 * Open is durable: the crate's field `open` (a boolean defined here on the crate's own id), written in one effect
 * by the press's transaction, so the UNDO lever takes it back, "Reset the workshop" shuts every crate, and a visit
 * remembers which are open (`World.saved()`, sim/saved.ts). A crate the visitor opens is theirs (§ E5 rule 5: a
 * part a transaction changed is touched): Fetch never carries it, and Revert does not sweep an open crate.
 *
 * Nothing ever spills: the lid claps shut first, whenever the crate is
 * - picked up (written as the crate is let go, under the transaction that let it go: the lever puts the crate back
 *   where it was AND open again);
 * - taken by a machine (the belt, the striker under it, the dock, the platen), by the crew, down the chute, shipped
 *   or put away (charged as a machine's effect: to whoever placed it, § E5 rule 4);
 * - knocked moving, tipped over, or something comes to rest on it.
 * It opens only lying still, upright, with nothing on it, in nobody's hands or machine.
 *
 * A place for a thing (brief item 5). A crate may hold one thing: a loose part (any kind but a crate) whose scene
 * spec says `stowedIn: <crate id>`. Its durable location while it is in its crate is `in` that crate
 * (`{ at: 'in', station, mouth: <crate id> }`). Shut, it is out of the world (mode `gone`). Open, it sits on a small
 * tray at the front of the crate's mouth, in this unit's custody (mode `machine`), and rides along if the open crate
 * is moved. The visitor takes it off like any loose part (its rest is then wherever it lands); set down on the open
 * crate's tray again, it is stowed again (its location `in` the crate, charged to whoever set it down). A crate may be
 * shut while its thing is out. Out, it is a loose part like any other (the chute brings it back if it leaves the
 * bench); "Reset the workshop" stows it, because its starting location is `in` its crate.
 *
 *   Giving a crate its thing, three lines:
 *     1. the thing, in the scene's `parts`:     { id: 'ledger-tray', kind: 'tool', ..., stowedIn: 'crate-1' }
 *     2. the crate's entry, in the scene's `projects`:   { crate: 'crate-1', ..., holds: 'ledger-tray' }
 *     3. its piece, in the parts view (view/bench/stations/parts.ts `piece`): the kit function that draws it.
 *   (`bench.ts` `withStandIn` is the worked example: the kit's test block in t-components' crate.)
 *   What the tray allows a thing: view/bench/stations/parts.ts `THING` (0.3 tall over the tray's floor, 0.4 deep centred
 *   on the tray, as wide as the mouth). Taller and it stands in front of the card's lines and its plate.
 *
 *   Asking for the camera (any unit, any thing; round three), three steps:
 *     1. Answer `select` (a double-click or double-tap on it) in the unit's `intent()` for its own ids, and return true.
 *        The world has already put the thing back where it lay if the double-tap's first tap had taken it up.
 *     2. Emit `{ type: 'look', target }` whenever the camera should come (on a select, or as a show begins). `target`
 *        is any id; this unit's is its crate's `card` (`${crate}-card`).
 *     3. In the view, register `target` as a pick target that is never pressed, its box what must be in the picture:
 *        `ctx.pickable(target, object, { box, pad: 0, active: () => false })` (parts.ts does it for `${crate}-card`).
 *        The shell (`lookAt`) brings that box close enough to read and holds it (`CameraRig.look`: a robot in front of
 *        it goes see-through) until the visitor moves the camera. A select nobody answers frames the thing's station
 *        once the world has stepped.
 *
 * Events: `crate.opened` and `crate.shut` (with the project and why), `crate.plate` when the card's plate is
 * pressed (the controls list and the page open the project's entry on /resume/; a panel over the stage will hear
 * the same event later), and `handle.worked` on the latch (its click).
 */
import type { Cause, Id, Intent, Pose, Restore, SimEvent, StationId, Vec3 } from '../types.ts';
import type { SimContext, Unit } from '../context.ts';
import type { ProjectCrate, UnitFactory } from '../scene.ts';
import { gesture, handleTxn } from '../machine.ts';
import { steps } from '../clock.ts';
import { qmul, rotate } from '../math.ts';

/** The durable field a project crate's lid is: true open, false shut. */
export const OPEN = 'open';

/** Tune here. Units, units per second, radians per second. */
export const CRATES_TUNING = {
  /** Moving faster than this (linear, angular) while open, it claps shut: it has been knocked. */
  knocked: 0.9,
  spun: 3,
  /** Tipped further than this from upright (cosine of the angle between its up and the world's), it claps shut. */
  upright: Math.cos((25 * Math.PI) / 180),
  /** (P4 S6 round four) A lifted crate let go faster than this (units a second) is thrown: the view back at once. */
  thrownBack: 1.5,
  /** (P4 S6 round four) Let go over the deck: the view back if it is not open on the stand again within this (s). */
  backWait: 1,
  /** Something whose bottom is within this of the crate's top, over its footprint, is resting on it. */
  onTop: 0.12,
  /** The tray: how far forward of the crate's middle its thing sits (a share of the crate's half depth), and a hair over the rim. */
  trayForward: 0.42,
  trayLift: 0.006,
  /** A thing set down within this share of the crate's half extents of the tray, on the open crate, is stowed again. */
  trayCatch: 1.0,
  /** (round two) A crate asked for by a double-click or double-tap opens once it lies still, if it does within this (s). */
  selectWait: 1.5,
} as const;

export interface CratesSpec {
  readonly id: Id;
  readonly station: StationId;
}

const UP: Vec3 = [0, 1, 0];

export function crates(spec: CratesSpec): UnitFactory {
  return (ctx) => createCrates(ctx, spec);
}

export function createCrates(ctx: SimContext, spec: CratesSpec): Unit {
  const T = CRATES_TUNING;
  const list: readonly ProjectCrate[] = ctx.scene.projects ?? [];
  const byLid = new Map(list.map((c) => [c.lid, c]));
  const byPlate = new Map(list.map((c) => [c.plate, c]));
  /** Crates that were in the visitor's hand while open: they clap shut when let go (under the letting go). */
  const wasHeld = new Set<Id>();
  /**
   * (P4 S6 round two) Lifted off the stand open: shut at once to the eye and the ear (`crate.shut`, `look.back`), but the
   * setting is written when the hand lets go, under the transaction that letting-go opens: so one pull of the lever puts
   * it back on the stand open, as it was before it was lifted. (Written under the grab it was charged to the placing that
   * had set it on the stand, and the lever put it back shut.)
   */
  const lifted = new Set<Id>();
  /**
   * (P4 S6 round four) The camera stays in while a crate lifted off the stand is in the hand (`look.back` is not sent at
   * the lift) and goes out when it leaves the hand: at once, unless it was let go over the deck; then once it is clear it
   * will not be open on the stand again (it rests off the deck, a machine or the crew has it, or a second passes): the
   * step it was let go.
   */
  const backPending = new Map<Id, number>();
  /** Ask the page to give the view back from `c`'s card. */
  const lookBack = (c: ProjectCrate): void => {
    backPending.delete(c.crate);
    if (c.card !== undefined) ctx.emit({ type: 'look.back', target: c.card });
  };
  /** "Reset the workshop" has begun (`reset`); its `restored` follows in the same step and places every crate's thing. */
  let resetting = false;
  /**
   * (round two) A crate the visitor asked for by itself (`select`: a double-click or double-tap on it) that could not open
   * yet (the double-tap's first tap had lifted it; it is settling): it opens once it lies still, within `selectWait`.
   */
  const selected = new Map<Id, number>();
  /**
   * (P4 S6) The opening stand's switch: with it, a crate opens only in the stand's mouth (its unit does that), never by
   * its latch or a double-click; one open off the stand shuts; with `things: 'fixed'` its thing stays on its tray.
   */
  const stand = ctx.scene.openingStand ?? null;
  const standMouth = stand ? (ctx.scene.mouths ?? []).find((m) => m.id === stand.mouth) ?? null : null;
  /** Is this crate's middle in the stand's mouth? */
  const inStand = (crate: Id): boolean => {
    if (!standMouth) return false;
    const pose = ctx.pose(crate);
    if (!pose) return false;
    const yaw = ((standMouth.yaw ?? 0) * Math.PI) / 180;
    const dx = pose.p[0] - standMouth.c[0], dz = pose.p[2] - standMouth.c[2];
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.abs(lx) <= standMouth.half[0] && Math.abs(pose.p[1] - standMouth.c[1]) <= standMouth.half[1] && Math.abs(lz) <= standMouth.half[2];
  };

  for (const c of list) {
    // (the world's parts are not readable while units are made: the scene's specs say the same)
    const p = ctx.scene.parts.find((x) => x.id === c.crate);
    if (!p || p.kind !== 'crate') throw new Error(`crates: ${c.crate} is not a crate of this scene`);
    if (c.holds !== undefined) {
      const h = ctx.scene.parts.find((x) => x.id === c.holds);
      if (!h || h.kind === 'crate' || h.stowedIn !== c.crate) throw new Error(`crates: ${c.crate} holds ${String(c.holds)}, which is not a loose part stowed in it (nor may it be a crate)`);
    }
    ctx.defineSetting(c.crate, OPEN, false, (v) => typeof v === 'boolean');
    ctx.register({
      id: c.lid,
      station: p.station,
      name: 'name.lid',
      // (P4 S6) with the opening stand, a latch does nothing: no affordance, so not in the list
      affordances: stand ? [] : ['open', 'press'],
      tell: () => ctx.emit({ type: 'tell', id: c.lid }),
      misfire: (level) => ctx.emit({ type: 'misfire', id: c.lid, level }),
    });
    ctx.register({
      id: c.plate,
      station: p.station,
      name: 'name.plate',
      affordances: ['press'],
      tell: () => ctx.emit({ type: 'tell', id: c.plate }),
      misfire: (level) => ctx.emit({ type: 'misfire', id: c.plate, level }),
    });
  }

  const isOpen = (crate: Id): boolean => ctx.setting(crate, OPEN) === true;

  /** Is something lying on top of `crate` (its bottom at the crate's top, over its footprint)? Its own thing on its tray does not count. */
  function burdened(c: ProjectCrate): boolean {
    const pose = ctx.pose(c.crate);
    const half = ctx.halfExtents(c.crate);
    if (!pose || !half) return false;
    const top = pose.p[1] + half[1];
    for (const o of ctx.parts()) {
      if (o === c.crate || o === c.holds) continue;
      const m = ctx.mode(o);
      if (m === 'gone' || m === 'chute' || m === 'held') continue;
      const q = ctx.pose(o);
      const h = ctx.halfExtents(o);
      if (!q || !h) continue;
      const bottom = q.p[1] - h[1];
      if (bottom < top - T.onTop || bottom > top + T.onTop) continue;
      // over the crate's footprint (in its own frame, its yaw only: it is upright)
      const local = rotate([-pose.q[0], -pose.q[1], -pose.q[2], pose.q[3]], [q.p[0] - pose.p[0], 0, q.p[2] - pose.p[2]]);
      if (Math.abs(local[0]) < half[0] && Math.abs(local[2]) < half[2]) return true;
    }
    return false;
  }

  /** Lying still and upright, free, nothing on it: a crate that may open. */
  function mayOpen(c: ProjectCrate): boolean {
    if (ctx.mode(c.crate) !== 'free' || ctx.part(c.crate)?.location.at !== 'rest') return false;
    if (!ctx.settled(c.crate)) return false;
    const pose = ctx.pose(c.crate);
    if (!pose || rotate(pose.q, UP)[1] < T.upright) return false;
    return !burdened(c);
  }

  /**
   * Shut it, as a consequence (not a press): charged as a machine's effect on it is (§ E5 rule 4: whoever placed it,
   * while on the stack, or the system), never the crew's (the crew may not write a part the visitor touched); if that
   * transaction is older than the one that opened it (rule 7), the system's.
   */
  function clapShut(c: ProjectCrate, why: 'grab' | 'machine' | 'moved' | 'away' | 'burden', quiet = false): void {
    let cause: Cause = ctx.history.chargeMachine(c.crate);
    if (cause === 'crew') cause = 'system';
    let r = ctx.commit([{ target: c.crate, field: OPEN, after: false }], cause);
    if (r.refused.length > 0) r = ctx.commit([{ target: c.crate, field: OPEN, after: false }], 'system');
    if (r.effects.length > 0 && !quiet) {
      ctx.emit({ type: 'crate.shut', id: spec.id, crate: c.crate, project: c.project, why });
      // (D2d) shut by anything but the visitor's own latch: a look at its card has nothing left to show
      if (c.card !== undefined) ctx.emit({ type: 'look.back', target: c.card });
    }
  }

  /** Where a crate's thing sits on its tray: at the front of its mouth, a hair over the rim, turned with the crate. */
  function trayPose(c: ProjectCrate): Pose | null {
    if (c.holds === undefined) return null;
    const pose = ctx.pose(c.crate);
    const half = ctx.halfExtents(c.crate);
    const th = ctx.halfExtents(c.holds);
    if (!pose || !half || !th) return null;
    const off = rotate(pose.q, [0, half[1] + th[1] + T.trayLift, half[2] * T.trayForward]);
    return { p: [pose.p[0] + off[0], pose.p[1] + off[1], pose.p[2] + off[2]], q: qmul(pose.q, [0, 0, 0, 1]) };
  }

  const stowed = (c: ProjectCrate): boolean => {
    if (c.holds === undefined) return false;
    const l = ctx.part(c.holds)?.location;
    return !!l && l.at === 'in' && l.mouth === c.crate;
  };

  /** The thing where its crate says: on the tray while the crate is open in the world, out of the world while shut. */
  function placeThing(c: ProjectCrate, teleport: boolean): void {
    const id = c.holds;
    if (id === undefined || !stowed(c)) return;
    const m = ctx.mode(id);
    if (m === 'held') return;
    const show = isOpen(c.crate) && ctx.mode(c.crate) === 'free';
    const at = trayPose(c);
    if (show && at) {
      if (m === 'gone' || m === 'chute') {
        ctx.launch(id, at, [0, 0, 0], [0, 0, 0], null);
        ctx.take(id, spec.id);
        ctx.drive(id, at, true);
      } else if (m === 'free') {
        // free while its location says `in`: an undo or a reset has just put it back (the world leaves it where it was
        // for its machine to take); between those, free means a hand has just let go of it (its rest is the world's)
        if (teleport && ctx.take(id, spec.id)) ctx.drive(id, at, true);
      } else if (m === 'machine') ctx.drive(id, at, teleport);
      return;
    }
    // (D1 part five) put back in its shut crate by an undo or a reset from wherever it was: free, still waiting in the
    // chute, or in a crew member's hands (the world leaves those where they are): out of the world, for any crate's thing
    if (m === 'machine' || (teleport && (m === 'free' || m === 'chute' || m === 'crew'))) ctx.stow(id, at ?? (ctx.pose(id) as Pose));
  }

  /** A crate's thing set down on its open crate's tray: stowed again, charged to whoever set it down. */
  function catchThing(c: ProjectCrate): void {
    const id = c.holds;
    if (id === undefined || stowed(c) || !isOpen(c.crate) || ctx.mode(c.crate) !== 'free') return;
    if (ctx.mode(id) !== 'free' || !ctx.settled(id) || ctx.part(id)?.location.at !== 'rest') return;
    const at = trayPose(c);
    const q = ctx.pose(id);
    const half = ctx.halfExtents(c.crate);
    const cp = ctx.pose(c.crate);
    if (!at || !q || !half || !cp) return;
    // over the crate's open mouth (its own frame), resting on it
    const local = rotate([-cp.q[0], -cp.q[1], -cp.q[2], cp.q[3]], [q.p[0] - cp.p[0], q.p[1] - cp.p[1], q.p[2] - cp.p[2]]);
    if (Math.abs(local[0]) > half[0] * T.trayCatch || Math.abs(local[2]) > half[2] * T.trayCatch || local[1] < half[1] - 0.05) return;
    let cause: Cause = ctx.history.chargeMachine(id);
    if (cause === 'crew') cause = 'system';
    const r = ctx.commit([{ target: id, field: 'location', after: { at: 'in', station: spec.station, mouth: c.crate } }], cause);
    if (r.refused.length > 0) return;
    if (ctx.take(id, spec.id)) ctx.drive(id, at);
  }

  /** (round two) Ask the page to bring the crate's card close enough to read. */
  function look(c: ProjectCrate): void {
    if (c.card !== undefined) ctx.emit({ type: 'look', target: c.card });
  }
  /** The latch worked: open (and asks to be looked at) or shut (the camera stays where it is). */
  function toggle(c: ProjectCrate, open: boolean): void {
    ctx.emit({ type: 'handle.worked', id: c.lid, value: open ? 0 : 1 });
    const t = handleTxn(ctx, gesture(), 'press', c.lid);
    const r = ctx.commit([{ target: c.crate, field: OPEN, after: !open }], t);
    if (r.effects.length > 0) {
      if (open) ctx.emit({ type: 'crate.shut', id: spec.id, crate: c.crate, project: c.project, why: 'press' });
      else {
        ctx.emit({ type: 'crate.opened', id: spec.id, crate: c.crate, project: c.project });
        look(c);
      }
    }
    placeThing(c, true);
  }

  const unit: Unit = {
    id: spec.id,

    intent(intent: Intent): boolean {
      if (ctx.bracketed) return false;
      // (P4 S6) with the stand, neither the latch nor a double-click opens a crate (the stand does): a double-click frames
      // the station as before round two
      if (stand && (intent.type === 'select' || (intent.type === 'press' && byLid.has(intent.id)))) return false;
      if (intent.type === 'select') {
        // (round two) a double-click or double-tap on a project crate: it opens (now, or once it lies still), and asks to
        // be looked at; an open one asks to be looked at again
        const c = list.find((x) => x.crate === intent.id || x.lid === intent.id || x.plate === intent.id);
        if (!c) return false;
        if (isOpen(c.crate)) look(c);
        else if (mayOpen(c)) toggle(c, false);
        else if (ctx.mode(c.crate) === 'free' || ctx.mode(c.crate) === 'held') selected.set(c.crate, ctx.clock.step + steps(T.selectWait));
        else return false;
        return true;
      }
      if (intent.type !== 'press') return false;
      const lid = byLid.get(intent.id);
      if (lid) {
        const open = isOpen(lid.crate);
        if (!open && !mayOpen(lid)) return false; // in a hand, a machine, on the move, tipped, or something on it
        toggle(lid, open);
        return true;
      }
      const plate = byPlate.get(intent.id);
      if (plate && isOpen(plate.crate) && ctx.mode(plate.crate) === 'free') {
        ctx.emit({ type: 'handle.worked', id: plate.plate });
        ctx.emit({ type: 'crate.plate', id: spec.id, crate: plate.crate, project: plate.project });
        return true;
      }
      return false;
    },

    pre() {
      if (ctx.bracketed) return;
      for (const [crate, until] of [...selected]) {
        const c = list.find((x) => x.crate === crate);
        if (!c || ctx.clock.step > until || isOpen(crate)) selected.delete(crate);
        else if (mayOpen(c)) {
          selected.delete(crate);
          toggle(c, false);
        }
      }
      for (const c of list) {
        if (isOpen(c.crate)) {
          const m = ctx.mode(c.crate);
          // (P4 S6) with the stand, lifting it off shuts it: said now, written when it is let go (`lifted`)
          if (m === 'held' && stand && !lifted.has(c.crate)) {
            lifted.add(c.crate);
            wasHeld.add(c.crate);
            ctx.emit({ type: 'crate.shut', id: spec.id, crate: c.crate, project: c.project, why: 'grab' });
            backPending.delete(c.crate);
          } else if (m === 'held') wasHeld.add(c.crate);
          else if (m === 'free') {
            if (wasHeld.delete(c.crate)) {
              const said = lifted.delete(c.crate);
              // let go: a pick-up undone on the spot (set back exactly, at rest at once) never happened; anything else shuts it
              if (!ctx.settled(c.crate) || (stand && !inStand(c.crate))) {
                clapShut(c, 'grab', said);
                // (round four) out of the hand: the view back now, or (let go over the deck) once it will not reopen there
                if (said) {
                  const v = ctx.velocity(c.crate);
                  const thrown = !!v && Math.hypot(...v.linvel) > T.thrownBack;
                  if (inStand(c.crate) && !thrown) backPending.set(c.crate, ctx.clock.step);
                  else lookBack(c);
                }
              }
              // (set back on the spot, on the stand: open as it was; the camera never left it)
            } else {
              const v = ctx.velocity(c.crate);
              const pose = ctx.pose(c.crate);
              const moving = !!v && (Math.hypot(...v.linvel) > T.knocked || Math.hypot(...v.angvel) > T.spun);
              const tipped = !!pose && rotate(pose.q, UP)[1] < T.upright;
              if (moving || tipped) clapShut(c, 'moved');
              // (P4 S6: on the stand, a crate set down on top is the stand's to answer: it hands this one off)
              else if (ctx.settled(c.crate) && burdened(c) && !(stand && inStand(c.crate))) clapShut(c, 'burden');
              // (P4 S6) open only in the stand's mouth
              else if (stand && ctx.settled(c.crate) && !inStand(c.crate)) clapShut(c, 'moved');
            }
          } else {
            wasHeld.delete(c.crate);
            const said = lifted.delete(c.crate);
            clapShut(c, m === 'machine' || m === 'crew' ? 'machine' : 'away', said);
            if (said) lookBack(c); // (round four) taken from the hand by a machine or the crew: the view back
          }
        } else {
          wasHeld.delete(c.crate);
          // (round four) a lifted crate shut by other means while held or as it left the hand (an undo, a reset): the view back
          if (ctx.mode(c.crate) !== 'held' && lifted.delete(c.crate)) lookBack(c);
        }
        // (round four) let go over the deck: open on the stand again (the camera never moved), or the view back once it
        // is clear it will not be (it rests off the deck, it is taken, or a second has passed)
        const since = backPending.get(c.crate);
        if (since !== undefined) {
          const m = ctx.mode(c.crate);
          if (m === 'held') backPending.delete(c.crate);
          else if (isOpen(c.crate) && inStand(c.crate)) backPending.delete(c.crate);
          else if (m !== 'free' || (ctx.settled(c.crate) && !inStand(c.crate)) || ctx.clock.step - since > steps(T.backWait)) lookBack(c);
        }
        catchThing(c);
        placeThing(c, false);
      }
    },

    /** (P4 S6) With the stand and `things: 'fixed'`, a crate's thing on its tray is not a hand's: its controls work, it stays. */
    keeps(part: Id): boolean {
      if (!stand || stand.things !== 'fixed') return false;
      const c = list.find((x) => x.holds === part);
      return !!c && stowed(c);
    },

    lost(part) {
      // the visitor took the thing off its tray (or an undo, a reset, a put-away moved it): the world has it now
      void part;
    },

    restored(restores: readonly Restore[]) {
      // an undo or a reset moved a crate, opened or shut one, or put a thing back in its crate: everything where its crate says
      const touched = new Set(restores.map((r) => r.target));
      // (D1 part five) after "Reset the workshop" every crate's thing, changed or not: a thing whose location never left
      // its crate (taken off the tray and thrown off the bench before it rested: its location is still `in` its crate)
      // is in the chute or the world's hands, and nothing in the reset's list names it
      const all = resetting;
      resetting = false;
      for (const c of list) if (all || touched.has(c.crate) || (c.holds !== undefined && touched.has(c.holds))) placeThing(c, true);
      // (round four) a reset while a lifted crate is in the hand or just let go: the view back
      if (all) for (const c of list) if (lifted.has(c.crate) || backPending.has(c.crate)) {
        lifted.delete(c.crate);
        lookBack(c);
      }
      // (P4 S6 round two) an undo that opens a crate on the stand again (a lift-off taken back): looked at again, as it was
      if (stand && !all) for (const r of restores) if (r.field === OPEN && r.to === true) {
        const c = list.find((x) => x.crate === r.target);
        if (c && inStand(c.crate)) look(c);
      }
    },

    reset() {
      wasHeld.clear();
      selected.clear();
      resetting = true;
    },

    heard(events: readonly SimEvent[]) {
      void events;
    },
  };
  return unit;
}
