// P3 B2: the controls list's model on the whole bench (REWRITE.md § E9 "every interactable is also a button in an
// HTML controls list, grouped by station"; § E4 invariant 1: every interactable has a name). The DOM side draws
// exactly this (ui/controls/list.ts).
import { describe, expect, test } from 'vitest';
import { stubWorld, run } from '../sim/helpers.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';
import { listModel, itemLabel, plainName, type ControlsSource } from '../../../src/workshop/ui/controls/model.ts';
import { textOf, STATION_NAMES } from '../../../src/workshop/ui/controls/words.ts';
import { STATION_ADDRESSES } from '../../../src/workshop/ui/strip/strip.ts';
import { STATION_BOXES } from '../../../src/workshop/shell/bench-stage.ts';
import { createSurface } from '../../../src/workshop/input/surface.ts';
import type { World } from '../../../src/workshop/sim/world.ts';
import type { Id } from '../../../src/workshop/sim/types.ts';
import type { HeldKind } from '../../../src/workshop/input/gesture.ts';

const world = (): World => stubWorld(1, { scene: bench }).world;

/** The list's source on a bare world: input's own surface (usable, role, reading), the stations by registry. */
function source(w: World, o: { held?: { id: Id; what: HeldKind } | null; keys?: boolean } = {}): ControlsSource {
  const surface = createSurface({ world: () => w, ray: () => ({ origin: [0, 10, 10], dir: [0, -1, 0] }), pick: () => null, half: () => null, panels: () => new Set(['phone']), hidden: () => new Set(['line']), panelStation: () => 'patchlamp' });
  return {
    world: w,
    usable: () => surface.usable!(),
    role: (id) => surface.role(id),
    stationOf: (id) => w.interactable(id)?.station ?? (id === 'phone' ? 'patchlamp' : null),
    stations: Object.keys(STATION_BOXES),
    held: o.held ?? null,
    keyHold: o.keys ? { dest: null } : null,
    destinations: o.keys ? (o.held?.what === 'plug' ? w.scene.cord.jacks.map((j) => j.id) : (w.scene.mouths ?? []).map((m) => m.id)) : [],
    reading: (id) => surface.reading!(id),
  };
}

describe('names (§ E4 invariant 1: every interactable has a name a screen reader can say)', () => {
  test('every registry entry’s name on the whole bench resolves to a content entry', () => {
    const w = world();
    const missing: string[] = [];
    for (const it of w.interactables()) if (!textOf(it.name)) missing.push(`${it.id}: ${it.name}`);
    for (const j of bench.cord.jacks) if (!textOf(j.name)) missing.push(`${j.id}: ${j.name}`);
    expect(missing).toEqual([]);
  });
  test('every mouth, every jack and the phone have a plain name (they are the destinations and a button)', () => {
    const w = world();
    for (const id of [...(bench.mouths ?? []).map((m) => m.id), ...bench.cord.jacks.map((j) => j.id), 'phone']) expect(plainName(w, id), id).not.toBe(id);
  });
  test('every station the bench frames has a heading, and the addresses are the same stations', () => {
    expect(Object.keys(STATION_BOXES).sort()).toEqual([...STATION_ADDRESSES].sort());
    for (const st of STATION_ADDRESSES) expect(STATION_NAMES[st], st).toBeTruthy();
  });
});

describe('the list', () => {
  test('grouped by station, the Button first; what is not on the bench is not a button', () => {
    const w = world();
    const m = listModel(source(w));
    expect(m.stations.map((s) => s.id)).toEqual(['button', 'patchlamp', 'line', 'top']);
    const ids = m.stations.flatMap((s) => s.items.map((i) => i.id));
    // shipped spares, Revert in its hatch: not on the bench
    for (const gone of ['crate-spare-1', 'crate-spare-2', 'crate-spare-3', 'revert']) expect(ids).not.toContain(gone);
    // the cover before Revert has fitted it; the jacks and mouths (destinations only); the line (through the phone)
    for (const no of ['button-cover', 'jack-storefront', 'belt', 'dock', 'platen', 'line']) expect(ids).not.toContain(no);
    for (const yes of ['button', 'undo-lever', 'cord', 'patch', 'phone', 'belt-dial', 'belt-lever', 'dock-bell', 'lamp', 'crate-1', 'fetch']) expect(ids).toContain(yes);
    expect(m.hold).toBeNull();
    expect(m.busy).toBe(false);
  });

  test('a thing’s state where it matters to someone who cannot see it', () => {
    const w = world();
    const src = source(w);
    expect(itemLabel(src, 'belt-dial')).toBe('Belt speed dial, 3 of 5');
    expect(itemLabel(src, 'belt-lever')).toBe('Belt direction lever, forwards');
    expect(itemLabel(src, 'cord')).toBe('Patch cord, in the Storefront jack');
    expect(itemLabel(src, 'button')).toBe('Big Red Button');
    expect(itemLabel(src, 'crate-1')).toBe('Large crate');
    expect(itemLabel(src, 'fetch')).toBe('Fetch'); // yellow by nature: no news
    w.dispatch({ type: 'turn', id: 'belt-lever', value: 0.5 });
    w.dispatch({ type: 'press', id: 'button' });
    run(w, 2);
    expect(itemLabel(src, 'belt-lever')).toBe('Belt direction lever, stopped');
    expect(itemLabel(src, 'button')).toBe('Big Red Button, pressed once');
    expect(itemLabel(source(w, { held: { id: 'crate-3', what: 'part' } }), 'crate-3')).toBe('Small crate, held');
  });

  test('while the Button’s rung plays, nothing responds: the list says busy (its buttons stay, aria-disabled)', () => {
    const w = world();
    w.dispatch({ type: 'press', id: 'button' });
    run(w, 3);
    expect(w.bracketed).toBe(true);
    const m = listModel(source(w));
    expect(m.busy).toBe(true);
    expect(m.stations.length).toBeGreaterThan(0);
  });

  test('while the keys hold a part, the list offers the mouths; holding the plug, the jacks', () => {
    const w = world();
    const part = listModel(source(w, { held: { id: 'crate-3', what: 'part' }, keys: true }));
    expect(part.hold?.label).toBe('Holding: Small crate. Where should it go?');
    expect(part.hold?.dests.map((d) => d.label)).toEqual(['Belt', 'Dock', 'Platen']);
    const plug = listModel(source(w, { held: { id: 'cord', what: 'plug' }, keys: true }));
    expect(plug.hold?.dests.map((d) => d.label)).toEqual(['Reserved jack 1', 'Reserved jack 2', 'Storefront jack', 'Platen jack', 'Belt jack', 'Lamp jack']);
    // held by the pointer (tap-then-tap), the list stays the list
    expect(listModel(source(w, { held: { id: 'crate-3', what: 'part' } })).hold).toBeNull();
  });
});
