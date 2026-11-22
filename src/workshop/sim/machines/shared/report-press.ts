/**
 * The report press's arithmetic and its sequence (P4 D3; DEMO-CONCEPTS.md concept 3, approved 2026-11-21; the
 * brief's change: a small machine of its own in the Report Generation Framework's crate, not the platen). Pure
 * functions over plain values, so every rule is tested alone (tests/unit/sim/report-press.test.ts) and the unit
 * (`press.ts`) only decides when they run.
 *
 * What it stands for, and nothing more (the published entry: /resume/ "Report Generation Framework"): a new report
 * implements one data method and the framework does the rest: rendering to PDF and to Excel, storing a copy, and a
 * queued email. One pull of one lever: the data in (the bench's own record of what the dock has shipped this visit),
 * two sheets out (the printed one: a row of stamped marks; the gridded one: the same marks one to a cell), a copy
 * into the drawer, and an envelope flicked onto the belt, which is the queue. No words on any sheet: a report with
 * invented text would be an invented fact.
 *
 * THE REPORT. `Report`: the paint names of the shipments it shows, oldest first, newest last: at most `REPORT_MAX`
 * (the most recent), one mark each. `null` is an empty holder (nothing printed yet); `[]` is an honest empty report
 * (ruled, no marks: nothing has shipped).
 */

/** A report as printed: the shipments' paint names, oldest first (null: nothing printed). */
export type Report = readonly string[] | null;

/** The most marks a sheet holds (the gridded sheet's cells: four across, three down); the rest are the oldest, left off. */
export const REPORT_MAX = 12;
/** The drawer's count is never more than this (a sheet a second for over two hours). */
export const DRAWER_MAX = 9999;

/** A paint name as the simulation carries it (an opaque palette token's name). */
const NAME = /^[a-z][a-z0-9-]{0,31}$/;

export const validReport = (v: unknown): v is Report => v === null || (Array.isArray(v) && v.length <= REPORT_MAX && v.every((x) => typeof x === 'string' && NAME.test(x)));
export const validDrawer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= DRAWER_MAX;
export const validSeal = (v: unknown): v is string | null => v === null || (typeof v === 'string' && NAME.test(v));

/** One shipment as the press heard it: which part, in the paint it had as it went through the door. */
export interface Shipment {
  readonly part: string;
  readonly colour: string;
}

/** The report of a record of shipments: the newest `REPORT_MAX`, oldest first. */
export function reportOf(record: readonly Shipment[]): readonly string[] {
  return record.slice(-REPORT_MAX).map((s) => s.colour);
}

/** The seal on the envelope: the colour of the report's last mark (null: an empty report's envelope is sealed plain). */
export const sealOf = (r: Report): string | null => (r && r.length > 0 ? (r[r.length - 1] ?? null) : null);

// ───────────────────────── the sequence: what is seen and heard, beat by beat (transient; the view performs it) ─────────────────────────

/**
 * A beat of one pull, timed from the pull (`at`, seconds; `dur` its travel):
 * - `thunk`: the lever comes down and the top blank is taken in (the old sheets drop into their slots).
 * - `ratchet`: the printed sheet comes up out of its slot one click (`n` 0..3).
 * - `flip`: the gridded sheet flips over into the holder beside it.
 * - `fold`: the envelope on the arm's bed folds one flap (`n` 0..2).
 * - `wind`: the spring arm winds back (the held breath before the flick).
 * - `flick`: the spring arm flicks the envelope off its bed (the simulation launches it here).
 * - `shrug`: the arm's bed comes up empty (the envelope is still out): a small shrug of the spring.
 * - `drawer`: the drawer slides out; `copy`: the copy drops into it (the stack one thicker); `click`: it shuts.
 */
export type PressBeatKind = 'thunk' | 'ratchet' | 'flip' | 'fold' | 'wind' | 'flick' | 'shrug' | 'drawer' | 'copy' | 'click';
export interface PressBeat {
  readonly at: number;
  readonly kind: PressBeatKind;
  readonly dur: number;
  readonly n: number;
}

/** Tune here. Seconds. One pull is about three and a half; each beat by itself. */
export const PRESS_SHOW = {
  /** The lever gives a little, then goes: the thunk is the platen landing. */
  thunkAt: 0.2,
  thunk: 0.12,
  ratchetAt: 0.5,
  ratchetGap: 0.17,
  ratchet: 0.08,
  ratchets: 4,
  flipAt: 1.22,
  flip: 0.36,
  foldAt: 1.72,
  foldGap: 0.24,
  fold: 0.18,
  folds: 3,
  /** The spring arm winds back (a held breath), then flicks. */
  windAt: 2.38,
  wind: 0.3,
  flickAt: 2.7,
  flick: 0.16,
  shrugAt: 1.75,
  shrug: 0.6,
  drawerAt: 3.0,
  drawer: 0.24,
  copyAt: 3.3,
  copy: 0.12,
  clickAt: 3.55,
  click: 0.18,
} as const;

export interface PressScript {
  readonly beats: readonly PressBeat[];
  readonly length: number;
  /** Seconds from the pull to the flick (the envelope's launch), or null when the bed comes up empty. */
  readonly flickAt: number | null;
}

const beat = (at: number, kind: PressBeatKind, dur: number, n = 0): PressBeat => ({ at, kind, dur, n });

/** One pull's beats: the envelope folded and flicked (`envelope`), or the bed's shrug. */
export function pullScript(envelope: boolean): PressScript {
  const S = PRESS_SHOW;
  const out: PressBeat[] = [beat(S.thunkAt, 'thunk', S.thunk)];
  for (let i = 0; i < S.ratchets; i++) out.push(beat(S.ratchetAt + i * S.ratchetGap, 'ratchet', S.ratchet, i));
  out.push(beat(S.flipAt, 'flip', S.flip));
  if (envelope) {
    for (let i = 0; i < S.folds; i++) out.push(beat(S.foldAt + i * S.foldGap, 'fold', S.fold, i));
    out.push(beat(S.windAt, 'wind', S.wind), beat(S.flickAt, 'flick', S.flick));
  } else out.push(beat(S.shrugAt, 'shrug', S.shrug));
  out.push(beat(S.drawerAt, 'drawer', S.drawer), beat(S.copyAt, 'copy', S.copy), beat(S.clickAt, 'click', S.click));
  return { beats: out, length: out.reduce((m, b) => Math.max(m, b.at + b.dur), 0), flickAt: envelope ? S.flickAt : null };
}

/** How far a beat of this kind has gone at `t` seconds into a script: 0 before it, 1 after it (the latest of that kind, by `n`). */
export function beatAt(script: PressScript, kind: PressBeatKind, t: number, n?: number): number {
  let k = 0;
  for (const b of script.beats) {
    if (b.kind !== kind || (n !== undefined && b.n !== n) || t < b.at) continue;
    k = b.dur <= 0 ? 1 : Math.min(1, (t - b.at) / b.dur);
  }
  return k;
}
