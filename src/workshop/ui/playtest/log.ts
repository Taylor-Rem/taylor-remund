/**
 * The playtest log (P3 B3; REWRITE.md § I, § E10): what a tester did and what
 * came of it, in memory only, with § I's thresholds computed from it. Pure:
 * no DOM, no clock, no storage; ui/playtest/index.ts feeds it and offers the
 * file. Times are milliseconds from navigation start.
 *
 * What is never in it: the words a visitor typed into the in-world phone (a
 * text is "typed", or the ready-made text it was), or any value a text wrote
 * into the world (effects are logged by target and field, never by value).
 */

export type InputKind = 'mouse' | 'touch' | 'pen' | 'keys' | 'unknown';

/** A deliberate action, as § I counts them. */
export type Verb = 'press' | 'turn' | 'pick-up' | 'let-go' | 'put-down' | 'throw' | 'plug' | 'text' | 'undo' | 'reset';

export type Row =
  | { t: number; kind: 'page'; tier: string; why: string; viewport: Viewport; motion: MotionInfo; sound: boolean }
  | { t: number; kind: 'picture' }
  | { t: number; kind: 'usable' }
  | { t: number; kind: 'action'; seq: number; verb: Verb; input: InputKind; id?: string; at?: string | readonly number[]; value?: number; speed?: number; text?: 'typed' | { ready: string } }
  | { t: number; kind: 'consequence'; event: string; cause: number | null; machine?: string; id?: string; part?: string; field?: string; at?: readonly number[]; rung?: number }
  | { t: number; kind: 'first-use'; station: string; cause: number | null }
  | { t: number; kind: 'strip'; control: string }
  | { t: number; kind: 'settings'; control: string; value?: string }
  | { t: number; kind: 'visibility'; hidden: boolean }
  | { t: number; kind: 'tier'; tier: string; why: string }
  | { t: number; kind: 'viewport'; viewport: Viewport }
  | { t: number; kind: 'motion'; motion: MotionInfo };

export interface Viewport {
  w: number;
  h: number;
  dpr: number;
}
export interface MotionInfo {
  setting: string;
  system: boolean;
  reduced: boolean;
}

/** A tester is stalled after this long without input (§ I: "more than 15 s"). */
export const STALL_MS = 15_000;
/** § I's "first 2 minutes". */
export const FIRST_MS = 120_000;
/** Machines acting under one action that make a chain (§ I: "one action causing a second machine to act"). */
export const CHAIN_MACHINES = 2;

export interface Gap {
  from: number;
  to: number;
  ms: number;
}

/** § I's table, as raw figures from the log (the observer judges; nothing here passes or fails anyone). */
export interface Thresholds {
  /** Where the clock starts for "the first 2 minutes": the picture, else the first row. */
  from: number;
  pictureAt: number | null;
  usableAt: number | null;
  firstAction: { at: number; afterPicture: number | null; afterUsable: number | null; verb: Verb; id: string | null; input: InputKind } | null;
  /** Different things used (ids acted on) and stations first used, in the first 2 minutes. */
  thingsInFirst2Min: { count: number; ids: string[] };
  stationsInFirst2Min: { count: number; ids: string[] };
  /** Actions after which two or more machines acted. */
  chain: { reached: boolean; firstAt: number | null; actions: { seq: number; at: number; verb: Verb; id: string | null; machines: string[] }[] };
  /** Did they carry on past 2 minutes? */
  pastTwoMinutes: { actionsAfter: number; lastActionAt: number | null };
  /** Gaps of more than 15 s without input, once the bench was usable (the end of the log closes the last one). */
  stalls: Gap[];
  /** When the strip's Résumé link was pressed (the observer asks at a time they note). */
  resumeAt: number[];
  /** Worth writing down: presses on the Big Red Button. */
  buttonPresses: number;
  /** Not in the log: said aloud. */
  whoseSite: 'ask the tester';
}

export interface LogInput {
  rows: readonly Row[];
  /** Times of every press, key, wheel or touch (not pointer moves). */
  inputs: readonly number[];
  /** When the log was taken. */
  end: number;
}

/** The figures for § I's thresholds. */
export function thresholds(log: LogInput): Thresholds {
  const rows = log.rows;
  const picture = rows.find((r) => r.kind === 'picture')?.t ?? null;
  const usable = rows.find((r) => r.kind === 'usable')?.t ?? null;
  const from = picture ?? rows[0]?.t ?? 0;
  const actions = rows.filter((r): r is Extract<Row, { kind: 'action' }> => r.kind === 'action');
  const first = actions[0] ?? null;

  const within = (t: number): boolean => t - from <= FIRST_MS;
  const things: string[] = [];
  for (const a of actions) if (a.id && within(a.t) && !things.includes(a.id)) things.push(a.id);
  const stations: string[] = [];
  for (const r of rows) if (r.kind === 'first-use' && within(r.t) && !stations.includes(r.station)) stations.push(r.station);

  const machinesBy = new Map<number, Set<string>>();
  for (const r of rows) {
    if (r.kind !== 'consequence' || r.cause === null || !r.machine) continue;
    let s = machinesBy.get(r.cause);
    if (!s) machinesBy.set(r.cause, (s = new Set()));
    s.add(r.machine);
  }
  const chains = actions
    .filter((a) => (machinesBy.get(a.seq)?.size ?? 0) >= CHAIN_MACHINES)
    .map((a) => ({ seq: a.seq, at: a.t, verb: a.verb, id: a.id ?? null, machines: [...machinesBy.get(a.seq)!] }));

  const stalls: Gap[] = [];
  if (usable !== null) {
    let prev = usable;
    for (const t of [...log.inputs].sort((a, b) => a - b)) {
      if (t < usable) continue;
      if (t - prev > STALL_MS) stalls.push({ from: prev, to: t, ms: t - prev });
      prev = t;
    }
    if (log.end - prev > STALL_MS) stalls.push({ from: prev, to: log.end, ms: log.end - prev });
  }

  return {
    from,
    pictureAt: picture,
    usableAt: usable,
    firstAction: first
      ? { at: first.t, afterPicture: picture === null ? null : first.t - picture, afterUsable: usable === null ? null : first.t - usable, verb: first.verb, id: first.id ?? null, input: first.input }
      : null,
    thingsInFirst2Min: { count: things.length, ids: things },
    stationsInFirst2Min: { count: stations.length, ids: stations },
    chain: { reached: chains.length > 0, firstAt: chains[0]?.at ?? null, actions: chains },
    pastTwoMinutes: { actionsAfter: actions.filter((a) => !within(a.t)).length, lastActionAt: actions.at(-1)?.t ?? null },
    stalls,
    resumeAt: rows.filter((r) => r.kind === 'strip' && r.control === 'resume').map((r) => r.t),
    buttonPresses: rows.filter((r) => r.kind === 'consequence' && r.event === 'button.pressed').length,
    whoseSite: 'ask the tester',
  };
}

/** The file: the figures at the top, then what was known about the visit, then every row. */
export function logFile(log: LogInput, context: Record<string, unknown>): string {
  const rows = [...log.rows].sort((a, b) => a.t - b.t);
  return JSON.stringify({ log: 'workshop playtest', version: 1, thresholds: thresholds(log), context, rows }, null, 1);
}
