/**
 * What the controls list shows (P3 B2; REWRITE.md § E9 "every interactable
 * is also a button in an HTML controls list, grouped by station"), as plain
 * data, so it is tested in Node (tests/unit/ui/controls-model.test.ts) and
 * the DOM side (list.ts) only draws it.
 *
 * The source of truth for what can be used is the input's own (`usable()`,
 * the list the canvas's Tab walked: input/surface.ts), for what a hand does
 * with it the input's role, and for where it goes while held the input's
 * destinations. So the list and the canvas can never disagree.
 *
 * What is NOT a button:
 *   - a part that is not on the bench: shipped, a spare not yet out, down
 *     the return chute (`usable()` leaves them out: the world would refuse);
 *   - the Button's cover before Revert has fitted it (there is nothing to
 *     lift); the jacks (they are where the cord goes: destinations while the
 *     keys hold the plug); the machines that are only mouths (belt, dock,
 *     platen: destinations while the keys hold a part).
 * What is a button that does nothing now: everything, while a Button rung
 * plays (§ B4: parts and handles do not respond). They stay in the list,
 * `aria-disabled`, so focus never falls out from under the visitor; using
 * one says why (`said.busy`).
 */
import type { Id, LedgerView, WorldView } from '../../sim/types.ts';
import { LEDGER, PAINT, PRESS } from '../../sim/index.ts';
import { TOOLWALL, pegId } from '../../sim/index.ts';
import type { HandleReading, HeldKind, Role } from '../../input/gesture.ts';
import { LIST, STATION_NAMES, fill, paintName, textOf } from './words.ts';
import { BENCH_PROJECTS } from '../../../content/bench-projects.ts';
import type { ProjectCrate } from '../../sim/types.ts';

/** What the model reads (the running workshop, narrowed; a stub in the unit tests). */
export interface ControlsSource {
  readonly world: WorldView;
  /** Everything usable now, in the registry's order (input/surface.ts `usable`). */
  usable(): readonly Id[];
  role(id: Id): Role;
  /** The station a thing is framed with now (shell/boot.ts `Framings.of`), or null. */
  stationOf(id: Id): string | null;
  /** The stations, in the list's order (the framings' order). */
  readonly stations: readonly string[];
  /** What input holds (by keys, pointer or tap). */
  readonly held: { readonly id: Id; readonly what: HeldKind } | null;
  /** While the keys hold something: where it may go, and the one chosen. */
  readonly keyHold: { readonly dest: Id | null } | null;
  readonly destinations: readonly Id[];
  reading(id: Id): HandleReading | null;
}

export interface ListItem {
  readonly id: Id;
  /** The accessible name and the visible label: the thing's name, and its state where that matters. */
  readonly label: string;
  /** P4 S5: a real link instead of a button (a project crate's plate: its entry on /resume/). */
  readonly href?: string;
}

/** P4 S5: the project crate a thing is (the crate itself, its latch or its card's plate), and which of them. */
export function projectOf(w: WorldView, id: Id): { readonly crate: ProjectCrate; readonly as: 'crate' | 'lid' | 'plate'; readonly title: string; readonly href: string } | null {
  for (const c of w.scene.projects ?? []) {
    const as = id === c.crate ? 'crate' : id === c.lid ? 'lid' : id === c.plate ? 'plate' : null;
    if (!as) continue;
    const p = BENCH_PROJECTS[c.project];
    return p ? { crate: c, as, title: p.title, href: p.href } : null;
  }
  return null;
}
export interface ListStation {
  readonly id: string;
  readonly name: string;
  readonly items: readonly ListItem[];
}
export interface ListModel {
  readonly stations: readonly ListStation[];
  /** While the keys hold something: what, and where it may go. Null otherwise. */
  readonly hold: { readonly id: Id; readonly what: HeldKind; readonly label: string; readonly dests: readonly ListItem[] } | null;
  /** A Button rung is playing: nothing responds. */
  readonly busy: boolean;
}

/** A thing's plain name: a crate by its size, anything else by its content name ("Fetch"), the phone by world.json's. */
export function plainName(w: WorldView, id: Id): string {
  // a project crate by its project's published title; its latch and its plate by the same
  const pr = projectOf(w, id);
  if (pr) return pr.as === 'crate' ? pr.title : fill(pr.as === 'lid' ? LIST.crateLid : LIST.cratePlate, { project: pr.title });
  const p = w.part(id);
  if (p?.kind === 'crate') return LIST.crate[p.size] ?? textOf('name.crate') ?? id;
  const it = w.interactable(id);
  if (it) return textOf(it.name) ?? id;
  const mouth = (w.scene.mouths ?? []).find((m) => m.id === id);
  if (mouth) {
    // (P4 T2) a mouth named for its machine: a tool's place on the wall is the wall's
    const owner = w.interactable(mouth.id) ?? w.interactable(mouth.machine);
    if (owner) return textOf(owner.name) ?? id;
  }
  const jack = w.scene.cord.jacks.find((j) => j.id === id);
  if (jack) return textOf(jack.name) ?? id;
  return textOf(`name.${id}`) ?? id;
}

/** A thing's name with its state, where the state matters to someone who cannot see it (§ E9). */
export function itemLabel(src: ControlsSource, id: Id): string {
  const w = src.world;
  const S = LIST.state;
  let name = plainName(w, id);
  const p = w.part(id);
  if (p) {
    // its paint once it is not what it started as (Fetch is yellow by nature; a crate painted blue is news)
    const start = w.scene.parts.find((s) => s.id === id)?.colour;
    const colour = p.colour !== start ? paintName(p.colour) : null;
    if (colour) name = fill(S.colour, { name, colour });
    if (p.label) name = fill(S.label, { name, label: p.label });
  }
  if (src.held?.id === id) return fill(S.held, { name });
  const role = src.role(id);
  const b = w.button();
  if (id === b.id) {
    if (b.presses === 1) return fill(S.pressedOnce, { name });
    if (b.presses > 1) return fill(S.pressed, { name, count: b.presses });
    return name;
  }
  if (id === b.coverId) return b.cover === 'open' ? fill(S.open, { name }) : b.cover === 'shut' ? fill(S.shut, { name }) : name;
  const pr = projectOf(w, id);
  if (pr?.as === 'lid') return fill(w.setting(pr.crate.crate, 'open') === true ? S.open : S.shut, { name });
  // (P4 D1) the ledger board: its red star, for someone who cannot see it
  const lv = ledgerOf(w, id);
  if (lv && id === lv.board && lv.wrong) return fill(S.starLit, { name });
  if (role === 'dial') {
    const r = src.reading(id);
    if (!r || r.detents < 2) return name;
    const n = Math.round(r.detents);
    return fill(S.level, { name, level: Math.round(r.value * (n - 1)) + 1, levels: n });
  }
  if (role === 'lever') {
    const r = src.reading(id);
    if (!r || Math.round(r.detents) !== 3) return name;
    const k = Math.round(r.value * 2);
    return fill(k === 0 ? S.backward : k === 1 ? S.stopped : S.forward, { name });
  }
  if (role === 'plug') {
    const cord = w.cord(id);
    if (cord && !cord.lifted) return fill(S.inJack, { name, jack: plainName(w, cord.jack) });
  }
  return name;
}

/** Is this usable thing something the list leaves out now (see the header)? */
function leftOut(w: WorldView, id: Id): boolean {
  const b = w.button();
  if (id === b.coverId && (b.cover === 'none' || b.cover === 'fitting')) return true;
  // (P4 S5) a project crate's latch while the crate is not on the bench (shipped, down the chute); its plate unless it is open there
  const pr = projectOf(w, id);
  if (pr && pr.as !== 'crate') {
    const mode = w.motion(pr.crate.crate)?.mode;
    if (mode === undefined || mode === 'gone' || mode === 'chute') return true;
    if (pr.as === 'plate' && (w.setting(pr.crate.crate, 'open') !== true || mode !== 'free')) return true;
  }
  // (P4 D2b) the paint dial's knob while the dial is not on the bench (in its crate, shipped, down the chute)
  const pv = w.machine(PAINT.unit);
  if (pv?.kind === 'paint-dial' && id === pv.knob) {
    const mode = w.motion(pv.dial)?.mode;
    if (mode === undefined || mode === 'gone' || mode === 'chute') return true;
  }
  // (P4 D1) the ledger board's crank and plunger while the board is not on the bench (in its crate, shipped, down the chute)
  const lv = ledgerOf(w, id);
  if (lv && id !== lv.board) {
    const mode = w.motion(lv.board)?.mode;
    if (mode === undefined || mode === 'gone' || mode === 'chute') return true;
  }
  // (P4 D3) the report press's lever while the press is not on the bench (in its crate, shipped, down the chute)
  if (id === PRESS.lever) {
    const mode = w.motion(PRESS.body)?.mode;
    if (mode === undefined || mode === 'gone' || mode === 'chute') return true;
  }
  return false;
}

/** P4 D1: the ledger board's view, if `id` is the board or one of its two controls. */
function ledgerOf(w: WorldView, id: Id): LedgerView | null {
  const v = w.machine(LEDGER.unit);
  return v?.kind === 'ledger' && (id === v.board || id === v.crank || id === v.plunger) ? v : null;
}

export function listModel(src: ControlsSource): ListModel {
  const w = src.world;
  const busy = w.bracketed;
  const byStation = new Map<string, ListItem[]>(src.stations.map((s) => [s, []]));
  for (const id of src.usable()) {
    if (leftOut(w, id)) continue;
    const st = src.stationOf(id);
    if (st === null) continue;
    let l = byStation.get(st);
    if (!l) byStation.set(st, (l = []));
    const pr = projectOf(w, id);
    l.push(pr?.as === 'plate' ? { id, label: itemLabel(src, id), href: pr.href } : { id, label: itemLabel(src, id) });
  }
  // two things that would read the same (two bare small crates) are told apart by a number, in list order
  const all = [...byStation.values()].flat();
  const count = new Map<string, number>();
  for (const it of all) count.set(it.label, (count.get(it.label) ?? 0) + 1);
  const nth = new Map<string, number>();
  for (const l of byStation.values())
    for (let i = 0; i < l.length; i++) {
      const it = l[i]!;
      if ((count.get(it.label) ?? 0) < 2) continue;
      const n = (nth.get(it.label) ?? 0) + 1;
      nth.set(it.label, n);
      l[i] = { ...it, label: `${it.label} ${n}` };
    }
  const stations: ListStation[] = [];
  for (const [id, items] of byStation) if (items.length > 0) stations.push({ id, name: STATION_NAMES[id] ?? id, items });
  let hold: ListModel['hold'] = null;
  if (src.held && src.keyHold) {
    const thing = plainName(w, src.held.id);
    hold = {
      id: src.held.id,
      what: src.held.what,
      label: fill(LIST.holding, { thing }),
      dests: numbered(src.destinations.filter((d) => placeFor(w, d, src.held!.id)).map((d) => ({ id: d, label: plainName(w, d) }))),
    };
  }
  return { stations, hold, busy };
}

/**
 * (P4 T2) Is `dest` a place for `held`? Every mouth is, but a tool's place on the wall (a mouth of the wall's), which is
 * only for that tool: the others' places would read as eight times "Tool wall" for a crate.
 */
function placeFor(w: WorldView, dest: Id, held: Id): boolean {
  // (I2) the opening stand is offered to a project crate only (it is what it is for; anything else just rests there)
  if (w.scene.openingStand && dest === w.scene.openingStand.mouth) return (w.scene.projects ?? []).some((c) => c.crate === held);
  const m = (w.scene.mouths ?? []).find((x) => x.id === dest);
  if (!m || m.machine !== TOOLWALL.unit) return true;
  return dest === pegId(held.replace(/^tool-/, ''));
}

/** Same-named entries told apart by a number, in order ("Reserved jack 1", "Reserved jack 2"). */
function numbered(items: readonly ListItem[]): ListItem[] {
  const count = new Map<string, number>();
  for (const it of items) count.set(it.label, (count.get(it.label) ?? 0) + 1);
  const nth = new Map<string, number>();
  return items.map((it) => {
    if ((count.get(it.label) ?? 0) < 2) return it;
    const n = (nth.get(it.label) ?? 0) + 1;
    nth.set(it.label, n);
    return { id: it.id, label: `${it.label} ${n}` };
  });
}

/** A string that changes when what the list shows changes (the DOM is touched only then). */
export function modelKey(m: ListModel): string {
  return JSON.stringify(m);
}
