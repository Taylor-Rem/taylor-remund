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
import type { Id, WorldView } from '../../sim/types.ts';
import type { HandleReading, HeldKind, Role } from '../../input/gesture.ts';
import { LIST, STATION_NAMES, fill, paintName, textOf } from './words.ts';

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
  const p = w.part(id);
  if (p?.kind === 'crate') return LIST.crate[p.size] ?? textOf('name.crate') ?? id;
  const it = w.interactable(id);
  if (it) return textOf(it.name) ?? id;
  const mouth = (w.scene.mouths ?? []).find((m) => m.id === id);
  if (mouth) {
    const owner = w.interactable(mouth.id);
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
  return id === b.coverId && (b.cover === 'none' || b.cover === 'fitting');
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
    l.push({ id, label: itemLabel(src, id) });
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
      l[i] = { id: it.id, label: `${it.label} ${n}` };
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
      dests: numbered(src.destinations.map((d) => ({ id: d, label: plainName(w, d) }))),
    };
  }
  return { stations, hold, busy };
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
