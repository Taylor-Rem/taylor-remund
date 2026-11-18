/**
 * The durable store (REWRITE.md § E5 "Three kinds of state": durable).
 * Every durable field of every part and every setting lives here, as a
 * value plus its **writer**: the cause that last wrote it (§ E5 rule 6).
 * Nothing outside `commit` (world.ts) and the history's restores
 * (history.ts: undo, reset) writes a value; `restore` exists only for the
 * Button's bracket, which puts back a snapshot taken by `snapshot`.
 *
 * A field is addressed by (target, field). Parts are targets whose fields
 * are the `Part` properties; settings are any other target (`cord`/`jack`).
 */
import type { Id, Location, Value, Writer } from './types.ts';

/** Who last wrote a field (defined with the public types, `types.ts`). */
export type { Writer } from './types.ts';

export interface Slot {
  readonly value: Value;
  readonly writer: Writer;
}

export interface StoreSnapshot {
  readonly fields: ReadonlyMap<string, Slot>;
}

const key = (target: Id, field: string): string => `${target}\u0000${field}`;

/** Deep, structural equality of durable values (locations, poses, string lists). */
export function sameValue(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => x === b[i]);
  }
  const la = a as Location;
  const lb = b as Location;
  if (la.at !== lb.at) return false;
  if (la.at === 'shipped') return true;
  if (la.at === 'in') return lb.at === 'in' && la.station === lb.station && la.mouth === lb.mouth;
  if (lb.at !== 'rest') return false;
  return la.pose.p.every((x, i) => x === lb.pose.p[i]) && la.pose.q.every((x, i) => x === lb.pose.q[i]);
}

/** Freeze a value so nothing holding a reference can change the store behind its back. */
function freezeValue(v: Value): Value {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return Object.freeze([...v]);
  const l = v as Location;
  if (l.at === 'rest') {
    const p = Object.freeze([l.pose.p[0], l.pose.p[1], l.pose.p[2]] as const);
    const q = Object.freeze([l.pose.q[0], l.pose.q[1], l.pose.q[2], l.pose.q[3]] as const);
    return Object.freeze({ at: 'rest', pose: Object.freeze({ p, q }) });
  }
  return Object.freeze({ ...l });
}

export class Store {
  #fields = new Map<string, Slot>();
  #targets = new Map<Id, Set<string>>();

  /** Declare a field with its starting value (writer `settled`). Only at world construction. */
  define(target: Id, field: string, value: Value): void {
    const k = key(target, field);
    if (this.#fields.has(k)) throw new Error(`store: ${target}.${field} is already defined`);
    this.#fields.set(k, { value: freezeValue(value), writer: 'settled' });
    let fs = this.#targets.get(target);
    if (!fs) this.#targets.set(target, (fs = new Set()));
    fs.add(field);
  }

  has(target: Id, field: string): boolean {
    return this.#fields.has(key(target, field));
  }

  slot(target: Id, field: string): Slot | undefined {
    return this.#fields.get(key(target, field));
  }

  get(target: Id, field: string): Value | undefined {
    return this.#fields.get(key(target, field))?.value;
  }

  writer(target: Id, field: string): Writer | undefined {
    return this.#fields.get(key(target, field))?.writer;
  }

  /** Write one field. Called only by the world's commit funnel. */
  write(target: Id, field: string, value: Value, writer: Writer): void {
    const k = key(target, field);
    if (!this.#fields.has(k)) throw new Error(`store: ${target}.${field} is not defined`);
    this.#fields.set(k, { value: freezeValue(value), writer });
  }

  /** Change only the writer of a field (forgetting and putting away settle it, § E5 rule 14). */
  setWriter(target: Id, field: string, writer: Writer): void {
    const s = this.slot(target, field);
    if (!s) throw new Error(`store: ${target}.${field} is not defined`);
    this.#fields.set(key(target, field), { value: s.value, writer });
  }

  fields(target: Id): readonly string[] {
    return [...(this.#targets.get(target) ?? [])];
  }

  targets(): readonly Id[] {
    return [...this.#targets.keys()];
  }

  /** Every (target, field, slot), in definition order: the replay check and the bracket compare these. */
  *entries(): Iterable<{ target: Id; field: string; slot: Slot }> {
    for (const [target, fs] of this.#targets) for (const field of fs) yield { target, field, slot: this.#fields.get(key(target, field)) as Slot };
  }

  /** Values are frozen, so a shallow copy of the map is an exact snapshot. */
  snapshot(): StoreSnapshot {
    return { fields: new Map(this.#fields) };
  }

  restore(s: StoreSnapshot): void {
    if (s.fields.size !== this.#fields.size) throw new Error('store: snapshot is from a different set of fields');
    this.#fields = new Map(s.fields);
  }
}
