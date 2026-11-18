/**
 * What the Patchlamp station's units share (REWRITE.md § B2 X1): the cord,
 * the phone line, Patch and the four stations on the lines. Machines do not
 * call each other (check-layers); this is the shared code they meet in:
 *
 * - the durable field names each station keeps, so the line can check a
 *   reply against the durable state without importing the station;
 * - the switchboard's transient state (`boardOf(ctx)`): which jacks are
 *   live and what unit answers on each, and how often the plug has been
 *   pulled (the cord counts, the line reads: "pull the cord out mid-job");
 * - `Beats`: the changes a station is showing (§ B2 X1 "each change a beat
 *   the view can perform and reverse") and its one-beat answer when the plug
 *   seats in its jack (§ D 4), both read off the event bus.
 *
 * Everything here is transient: nothing is recorded (§ E5 "Transient").
 */
import type { Id, Restore, SimEvent, StationBeat, TransactionId, Value, Vec3, Writer } from '../../types.ts';
import type { SimContext } from '../../context.ts';
import type { Jack } from '../../instruct/types.ts';
import { HZ } from '../../clock.ts';

/** How long a station lists a change it is showing, seconds (a view times its own beat inside this). */
export const PATCHLAMP_BEAT_SECONDS = 2.5;

/** The storefront's durable settings (target: the storefront's unit id). */
export const STOREFRONT_FIELDS = { sign: 'sign', words: 'words', awning: 'awning', open: 'open', picture: 'picture' } as const;
/** The lamp's durable settings (target: the lamp's unit id). `x`, `z`: where its arm holds the bulb (§ D 14). */
export const LAMP_FIELDS = { on: 'on', level: 'level', colour: 'colour', x: 'x', z: 'z' } as const;
/** The belt's (S2, sim/machines/belt.ts `BELT_FIELDS`; restated: machines do not import each other). */
export const BELT_FIELD_NAMES = { speed: 'speed', direction: 'direction', running: 'running' } as const;
/** What the platen writes on the part on its tray (§ B1 property table). */
export const PART_PAINT = { colour: 'colour', label: 'label' } as const;

/** The pictures the window has, in drum order; "next" goes round these five (sim/instruct `PICTURES`), the empty frame aside. */
export const WINDOW_PICTURES = ['mountains', 'sun', 'boat', 'tree', 'house'] as const;

/** One live line on the switchboard: the scene jack, its name, the unit that answers on it. */
export interface LiveLine {
  readonly jack: Id;
  readonly line: Jack;
  readonly station: Id;
}

/** The switchboard's transient state, one per world. */
export interface Board {
  /** Live lines (the phone line registers them when it is made). A jack not listed is capped (RESERVED) or unknown. */
  lines: readonly LiveLine[];
  /** How many times the plug has been lifted out of a jack this visit. */
  pulls: number;
  /** Where the lifted plug is (world), or null while it is seated. */
  plugAt: Vec3 | null;
  /** The station whose job Patch has in hand (its own lamp is steady while its verb runs, § B1), or null. */
  working: Id | null;
}

const boards = new WeakMap<SimContext, Board>();

/** The switchboard's shared state for this world. */
export function boardOf(ctx: SimContext): Board {
  let b = boards.get(ctx);
  if (!b) {
    b = { lines: [], pulls: 0, plugAt: null, working: null };
    boards.set(ctx, b);
  }
  return b;
}

const isTxn = (w: Writer | undefined): w is TransactionId => typeof w === 'string' && /^t\d+$/.test(w);

/**
 * § E5 rule 7, asked before committing rather than after: would any of these fields refuse `cause`
 * because a newer transaction has written it since? A station answers CHANGED_SINCE and commits
 * nothing, so a text's change is all or nothing (a reply never names half of it).
 */
export function newerWriter(ctx: SimContext, cause: Writer, fields: readonly { target: Id; field: string }[]): boolean {
  if (!isTxn(cause)) return false;
  const mine = Number(cause.slice(1));
  return fields.some(({ target, field }) => {
    const w = ctx.writer(target, field);
    return isTxn(w) && Number(w.slice(1)) > mine;
  });
}

/**
 * A station's beats: the changes it is showing, and its answer when the plug seats in its jack.
 * `owns(target, field)` says which effects are this station's to show.
 */
export class Beats {
  readonly #ctx: SimContext;
  readonly #id: Id;
  readonly #owns: (target: Id, field: string) => boolean;
  #beats: { field: string; part: Id | null; from: Value; to: Value; how: StationBeat['how']; at: number }[] = [];
  #answeredAt = -1;

  constructor(ctx: SimContext, id: Id, owns: (target: Id, field: string) => boolean) {
    this.#ctx = ctx;
    this.#id = id;
    this.#owns = owns;
  }

  #add(target: Id, field: string, from: Value, to: Value, how: StationBeat['how']): void {
    const part = target === this.#id ? null : target;
    this.#beats = this.#beats.filter((b) => !(b.field === field && b.part === part));
    this.#beats.push({ field, part, from, to, how, at: this.#ctx.clock.step });
  }

  #restores(rs: readonly Restore[], how: StationBeat['how']): void {
    // in the order to be seen running backwards (most recent change first, § E5 rule 11)
    for (const r of rs) if (this.#owns(r.target, r.field)) this.#add(r.target, r.field, r.from, r.to, how);
  }

  /** Read this step's events (call from `heard`). */
  heard(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'effect' && this.#owns(e.effect.target, e.effect.field)) this.#add(e.effect.target, e.effect.field, e.effect.before, e.effect.after, 'change');
      else if (e.type === 'undone') this.#restores(e.restores, 'undo');
      else if (e.type === 'reset') this.#restores(e.restores, 'reset');
      else if (e.type === 'jack.answered' && e.station === this.#id) this.#answeredAt = this.#ctx.clock.step;
    }
  }

  /** The beats still showing, oldest first. */
  view(): StationBeat[] {
    const now = this.#ctx.clock.step;
    const life = Math.round(PATCHLAMP_BEAT_SECONDS * HZ);
    this.#beats = this.#beats.filter((b) => now - b.at <= life);
    return this.#beats.map((b) => ({ field: b.field, part: b.part, from: b.from, to: b.to, how: b.how, since: (now - b.at) / HZ }));
  }

  /** Seconds since the plug last seated in this station's jack (Infinity before). */
  answered(): number {
    return this.#answeredAt < 0 ? Infinity : (this.#ctx.clock.step - this.#answeredAt) / HZ;
  }

  reset(): void {
    this.#answeredAt = -1;
  }
}

/** The scene jack whose line reaches `station`, or '' if none does (a station not on the board). */
export function jackFor(ctx: SimContext, station: Id): Id {
  return boardOf(ctx).lines.find((l) => l.station === station)?.jack ?? '';
}
