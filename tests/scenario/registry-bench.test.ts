// § E4 invariant 1 on the whole bench: every interactable the real bench registers (the scene the bench page
// boots, under real Rapier) has a name, a tell, a misfire and an affordance, and its name is a content id
// that resolves to an entry in src/content/ with words in it. The registry is the only source for the
// controls list and screen readers, so a name that resolves to nothing is a control with no words.
//
// One rule, not a list: a machine with a mouth (it has `accept`, § B1 law 2) is acted on by putting a part
// in it, so it may have no affordance of its own (the belt, the dock, the chute, the platen...).
import { expect, test } from 'vitest';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import { registryProblems } from '../../src/workshop/sim/registry.ts';
import { contentById, CONTENT_IDS } from '../../src/workshop/view/labels/content.ts';
import type { Interactable } from '../../src/workshop/sim/types.ts';

/** Everything wrong with a registry, one line per fault (empty when it is whole). */
export function benchRegistryFaults(all: readonly Interactable[]): string[] {
  const out = registryProblems(all);
  const known = new Set(CONTENT_IDS);
  for (const i of all) {
    const mouth = typeof (i as { accept?: unknown }).accept === 'function';
    if (Array.isArray(i.affordances) && i.affordances.length === 0 && !mouth) out.push(`${i.id}: no affordance and no mouth (nothing a visitor can do with it)`);
    if (typeof i.name !== 'string' || i.name === '') continue; // registryProblems has said so
    if (!known.has(i.name)) {
      out.push(`${i.id}: name ${JSON.stringify(i.name)} is not a content id (src/workshop/view/labels/content.ts BY_ID)`);
      continue;
    }
    const text = contentById(i.name).text;
    if (typeof text !== 'string' || text.trim() === '') out.push(`${i.id}: name ${i.name} resolves to an entry with no words`);
  }
  return out;
}

/**
 * Faults found 2026-11-21 (E1) in files outside this package (sim, content), reported to the lead. The test
 * holds the list EXACTLY: a new fault fails it, and so does fixing one of these (delete its line then).
 */
const KNOWN_FAULTS = [
  // sim/machines/cord.ts:73 gives a capped jack no affordance (it refuses the plug with slip.reserved):
  // either a capped jack is not an interactable, or its affordance is 'plug' (refused). Lead/owner to rule.
  'jack-reserved-1: no affordance and no mouth (nothing a visitor can do with it)',
  'jack-reserved-2: no affordance and no mouth (nothing a visitor can do with it)',
  // sim/machines/dock.ts:695 (12c85e3, the hand bell) names it `name.dock.bell`; there is no such entry in
  // src/content/line.json nor in content.ts BY_ID, so the bell has no words for a screen reader.
  'dock-bell: name "name.dock.bell" is not a content id (src/workshop/view/labels/content.ts BY_ID)',
];

test('every interactable on the whole bench has a name in content, a tell, a misfire and an affordance', async () => {
  const w = await benchWorld('registry-bench', { scene: FULL_BENCH });
  try {
    const all = [...w.interactables()];
    // the bench's own stations are all there (a registry that lost a machine would pass the walk below)
    const ids = all.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['button', 'button-cover', 'belt', 'belt-dial', 'belt-lever', 'striker', 'dock', 'chute', 'cord', 'line', 'patch', 'platen', 'storefront', 'lamp', 'undo-lever', 'revert', 'fetch', 'crate-1']) {
      expect(ids, id).toContain(id);
    }
    // every part is registered and can be grabbed (a crew member's own body is the crew's entry)
    for (const p of w.parts()) {
      if (w.scene.parts.find((d) => d.id === p.id)?.crewBody) continue;
      expect(w.interactable(p.id)?.affordances, p.id).toContain('grab');
    }
    expect(benchRegistryFaults(all)).toEqual(KNOWN_FAULTS);
    // the tell and the misfire can be called on every one without throwing (they are transient: § E4)
    for (const i of all) {
      i.tell();
      i.misfire(1);
    }
    w.drainEvents();
  } finally {
    w.dispose();
  }
});

test('the walk catches a name that is not in content, nothing to do with it, and the base faults', () => {
  const ok = { station: 'line', affordances: ['grab'], tell() {}, misfire() {} } as const;
  const bad = [
    { ...ok, id: 'a', name: 'name.nowhere' },
    { ...ok, id: 'b', name: 'name.belt', affordances: [] },
    { ...ok, id: 'c', name: '' },
    { ...ok, id: 'd', name: 'name.belt' },
    { ...ok, id: 'e', name: 'name.belt', affordances: [], accept() {} },
  ] as unknown as Interactable[];
  expect(benchRegistryFaults(bad)).toEqual([
    'c: no name',
    'a: name "name.nowhere" is not a content id (src/workshop/view/labels/content.ts BY_ID)',
    'b: no affordance and no mouth (nothing a visitor can do with it)',
  ]);
});
