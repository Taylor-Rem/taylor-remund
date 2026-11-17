/**
 * The one registry of everything a visitor can act on (REWRITE.md § E4
 * invariant 1). It is the only source for picking, the controls list,
 * tells, Button rungs, reset and saving.
 */
import type { Id, Interactable } from './types.ts';

export class Registry {
  #items = new Map<Id, Interactable>();

  add(i: Interactable): void {
    if (this.#items.has(i.id)) throw new Error(`registry: "${i.id}" is registered twice`);
    this.#items.set(i.id, i);
  }

  get(id: Id): Interactable | undefined {
    return this.#items.get(id);
  }

  /** In registration order (the scene's order: statics, parts, fixtures, then machines). */
  all(): Iterable<Interactable> {
    return this.#items.values();
  }
}

/** What is wrong with an interactable, if anything: every one needs a name, a tell and a misfire (§ E4 invariant 1). */
export function registryProblems(items: Iterable<Interactable>): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (typeof i.id !== 'string' || i.id === '') out.push('an interactable has no id');
    if (typeof i.name !== 'string' || i.name.trim() === '') out.push(`${i.id}: no name`);
    if (typeof i.tell !== 'function') out.push(`${i.id}: no tell`);
    if (typeof i.misfire !== 'function') out.push(`${i.id}: no misfire`);
    if (!Array.isArray(i.affordances)) out.push(`${i.id}: no affordances list`);
  }
  return out;
}
