/**
 * The ledger board's arithmetic (P4 D1; DEMO-CONCEPTS.md concept 1, approved 2026-11-21 with a condition): pure
 * functions over the board's one durable value, so every rule is tested alone (tests/unit/sim/ledger-board.test.ts)
 * and the unit (`ledger.ts`) only decides when they run.
 *
 * What it stands for, and nothing more (the published sentences: /resume/ "Ledger Management System" and the case
 * study /case-studies/ledger-repair/): a ledger's charges are cups, its payments are tokens dealt into them oldest
 * charge first, in three tiers (three finishes: brass, then copper, then steel, whatever order they lay in the
 * hopper). One payment bounces (the rubber token). Everything dealt after it was dealt as if it had counted: the
 * allocations are wrong, and a red star says so. The repair clears a month's allocations and re-processes its
 * payments in order, month by month, routing the bounced one to the side cup; every later payment lands one cup
 * earlier; one charge is honestly left unpaid at the end. Nothing is made to disappear.
 *
 * THE VALUE. `Tokens`: eight places, one per payment, in the order the payments are dealt (index 0 first). A place is
 * `h` (in the hopper), `c0`..`c7` (a cup: two months of four charges; c0..c3 month one, c4..c7 month two), `g` (the
 * gutter at the board's front edge: bounced out, not recorded), or `s` (the side cup: recorded as bounced). The one
 * rubber payment's place is written with an `r` in front (`rg`, `rs`, `rh`, `rc2`). Payments 0-2 are the first tier
 * (brass), 3-5 the second (copper), 6-7 the third (steel); the rubber token wears its tier's finish at its middle.
 */

export type Place = 'h' | 'g' | 's' | `c${number}`;
/** The board's durable value: eight places in deal order, the rubber one marked `r`. */
export type Tokens = readonly string[];

export const TOKENS = 8;
export const CUPS = 8;
export const MONTH = 4;
/** Each payment's tier (0, 1, 2): what finish it is drawn in. */
export const TIER: readonly number[] = [0, 0, 0, 1, 1, 1, 2, 2];
/** Where the rubber payment may sit in the deal: never last, so its gap always has payments standing past it. */
export const BOUNCE_RANGE = { from: 0, to: TOKENS - 2 } as const;

const PLACE = /^r?(h|g|s|c[0-7])$/;

export const isRubber = (s: string): boolean => s.startsWith('r');
export const placeOf = (s: string): Place => (isRubber(s) ? s.slice(1) : s) as Place;
export const cupIndex = (p: Place): number | null => (p.startsWith('c') ? Number(p.slice(1)) : null);
const mark = (rubber: boolean, p: Place): string => (rubber ? `r${p}` : p);

/** The rubber payment's index in the deal. */
export function rubberOf(t: Tokens): number {
  return t.findIndex(isRubber);
}

/** A well-formed value: eight places, exactly one rubber, no two payments in one cup, and the rubber never in a cup at rest. */
export function validTokens(v: unknown): v is Tokens {
  if (!Array.isArray(v) || v.length !== TOKENS) return false;
  let rubber = 0;
  const cups = new Set<number>();
  for (const s of v) {
    if (typeof s !== 'string' || !PLACE.test(s)) return false;
    if (isRubber(s)) rubber++;
    const c = cupIndex(placeOf(s));
    if (c !== null) {
      if (cups.has(c) || isRubber(s)) return false;
      cups.add(c);
    }
  }
  return rubber === 1;
}

/** Everything in the hopper, the rubber payment `bounce`-th in the deal: how a board starts. */
export function fresh(bounce: number): Tokens {
  return Array.from({ length: TOKENS }, (_, i) => mark(i === bounce, 'h'));
}

/** Dealt, and bounced: every payment in its own cup oldest charge first, the rubber one out in the gutter. */
export function dealt(bounce: number): Tokens {
  return Array.from({ length: TOKENS }, (_, i) => (i === bounce ? 'rg' : `c${i}`));
}

/** What the repair leaves: the payments that counted in the first cups in order, the bounced one in the side cup, the last cup empty. */
export function repaired(bounce: number): Tokens {
  let cup = 0;
  return Array.from({ length: TOKENS }, (_, i) => (i === bounce ? 'rs' : `c${cup++}`));
}

/**
 * Do the allocations add up? Yes when nothing has been dealt yet, or when the cups hold, from the first and with no
 * gap, exactly the payments that counted, in deal order, and the bounced one is recorded in the side cup. Anything
 * else is wrong: the red star.
 */
export function balanced(t: Tokens): boolean {
  if (t.every((s) => placeOf(s) === 'h')) return true;
  const r = rubberOf(t);
  if (r < 0 || placeOf(t[r]!) !== 's') return false;
  let cup = 0;
  for (let i = 0; i < t.length; i++) {
    if (i === r) continue;
    if (placeOf(t[i]!) !== `c${cup}`) return false;
    cup++;
  }
  return true;
}

/** Is there anything the plunger can put right? */
export const needsRepair = (t: Tokens): boolean => !balanced(t);

/** Where the rubber payment goes in the next deal: seeded, somewhere other than last time (`r` is a fresh draw in [0, 1)). */
export function nextBounce(last: number, r: number): number {
  const n = BOUNCE_RANGE.to - BOUNCE_RANGE.from + 1;
  const k = Math.min(n - 2, Math.floor(r * (n - 1)));
  const v = BOUNCE_RANGE.from + k;
  return v >= last ? v + 1 : v;
}

// ───────────────────────── the show: what is seen, beat by beat (transient; the view performs it) ─────────────────────────

/**
 * A beat of the board's show, timed from its start (`at`, seconds). A move takes `token` from `from` to `to` over
 * `dur`; `press` and `crank` are the controls' travel; `star` is the red star turning on (`on`) or off.
 * - `crank`: the crank turns once (the deal begins).
 * - `press`: the plunger goes down and comes back (the repair begins).
 * - `gather`: a token goes back to the hopper before a new deal.
 * - `drop`: a token leaves the hopper for a cup (a tick).
 * - `bounce`: the rubber token jumps out of its cup into the gutter.
 * - `wipe`: the repair empties a month's cups (and fetches the bounced payment from the gutter) back to the hopper.
 * - `gate`: the flip gate routes the rubber token from the cup it landed in to the side cup.
 * - `star`: the red star lamp lights (`on`) or goes dark.
 * - `rewind`: an undo or a reset puts a token back where it was (all at once, quickly).
 */
export type LedgerBeatKind = 'crank' | 'press' | 'gather' | 'drop' | 'bounce' | 'wipe' | 'gate' | 'star' | 'rewind';
export interface LedgerBeat {
  readonly at: number;
  readonly kind: LedgerBeatKind;
  readonly dur: number;
  readonly token: number | null;
  readonly from: Place | null;
  readonly to: Place | null;
  /** The month (0, 1) a wipe or a re-deal belongs to. */
  readonly month: number | null;
  /** For `star`. */
  readonly on?: boolean;
}

/** Tune here. Seconds. The plunger's whole repair is about two and a half. */
export const LEDGER_SHOW = {
  crank: 0.3,
  press: 0.22,
  gatherEach: 0.035,
  gather: 0.3,
  /** A new deal starts this long after the gather's last token is home. */
  settle: 0.12,
  dealGap: 0.15,
  flight: 0.24,
  bounceAfter: 0.5,
  bounce: 0.62,
  /** The repair: the press, then each month wiped, its payments dealt again, the gate. */
  wipeAfter: 0.12,
  wipeEach: 0.03,
  wipe: 0.26,
  redealAfter: 0.08,
  redealGap: 0.13,
  redealFlight: 0.2,
  gate: 0.24,
  monthGap: 0.1,
  starOff: 0.12,
  rewind: 0.35,
} as const;

const beat = (at: number, kind: LedgerBeatKind, dur: number, token: number | null = null, from: Place | null = null, to: Place | null = null, month: number | null = null, on?: boolean): LedgerBeat => ({ at, kind, dur, token, from, to, month, ...(on === undefined ? {} : { on }) });

export interface LedgerScript {
  readonly beats: readonly LedgerBeat[];
  /** Seconds from the start to the last beat's end. */
  readonly length: number;
}

const end = (beats: readonly LedgerBeat[]): number => beats.reduce((m, b) => Math.max(m, b.at + b.dur), 0);

/** The crank: everything out of the cups gathered to the hopper, then the deal in order, then the bounce, the star. */
export function dealScript(before: Tokens, after: Tokens): LedgerScript {
  const S = LEDGER_SHOW;
  const out: LedgerBeat[] = [beat(0, 'crank', S.crank)];
  let t = 0.08;
  // the star goes dark while the board is gathered (nothing is dealt, nothing is wrong)
  if (!balanced(before)) out.push(beat(t, 'star', 0, null, null, null, null, false));
  const away = before.map((s, i) => [i, placeOf(s)] as const).filter(([, p]) => p !== 'h');
  away.forEach(([i, p], k) => out.push(beat(t + k * S.gatherEach, 'gather', S.gather, i, p, 'h')));
  if (away.length > 0) t += (away.length - 1) * S.gatherEach + S.gather + S.settle;
  else t += S.settle;
  const r = rubberOf(after);
  for (let i = 0; i < TOKENS; i++) out.push(beat(t + i * S.dealGap, 'drop', S.flight, i, 'h', `c${i}`, Math.floor(i / MONTH)));
  const landed = t + (TOKENS - 1) * S.dealGap + S.flight;
  const b = landed + S.bounceAfter;
  out.push(beat(b, 'bounce', S.bounce, r, `c${r}`, 'g', Math.floor(r / MONTH)));
  out.push(beat(b + S.bounce, 'star', 0, null, null, null, null, true));
  return { beats: out, length: end(out) };
}

/**
 * The plunger: month by month, the month's cups emptied back to the hopper (the bounced payment fetched from the
 * gutter with them), then its payments dealt again in order: the rubber one lands in the cup it would have taken and
 * the gate flips it into the side cup at once; the next one takes that cup, and everything after lands one cup
 * earlier, month two's first payment back across into month one's last cup. Then the star goes dark.
 * `before` is the board as it was (dealt and bounced); `after` the repaired board (`repaired(bounce)`).
 */
export function repairScript(before: Tokens, after: Tokens): LedgerScript {
  const S = LEDGER_SHOW;
  const out: LedgerBeat[] = [beat(0, 'press', S.press)];
  const r = rubberOf(after);
  let t = S.press * 0.6 + S.wipeAfter;
  // where each payment is drawn as the show runs (it begins where `before` says)
  const now: Place[] = before.map(placeOf);
  for (let month = 0; month < CUPS / MONTH; month++) {
    // the month's transactions: the payments first dealt into its cups (by deal order), the bounced one with them
    const mine = Array.from({ length: TOKENS }, (_, i) => i).filter((i) => Math.floor(i / MONTH) === month);
    const out0 = mine.filter((i) => now[i] !== 'h');
    out0.forEach((i, k) => {
      out.push(beat(t + k * S.wipeEach, 'wipe', S.wipe, i, now[i]!, 'h', month));
      now[i] = 'h';
    });
    t += Math.max(0, out0.length - 1) * S.wipeEach + S.wipe + S.redealAfter;
    for (const i of mine) {
      const to = placeOf(after[i]!);
      if (i === r) {
        // it lands in the cup it would have taken, and the gate takes it across at once
        const cup: Place = `c${repairedCupOf(after, i)}`;
        out.push(beat(t, 'drop', S.redealFlight, i, 'h', cup, month));
        out.push(beat(t + S.redealFlight, 'gate', S.gate, i, cup, 's', month));
        now[i] = 's';
        t += S.redealFlight + S.gate * 0.7;
      } else {
        out.push(beat(t, 'drop', S.redealFlight, i, 'h', to, month));
        now[i] = to;
        t += S.redealGap;
      }
    }
    t += S.monthGap;
  }
  out.push(beat(t + S.redealFlight - S.redealGap, 'star', 0, null, null, null, null, false));
  return { beats: out, length: end(out) };
}

/** The cup a payment lands in during the repair before the gate (the rubber one: the next free cup in order). */
function repairedCupOf(after: Tokens, rubber: number): number {
  let cup = 0;
  for (let i = 0; i < rubber; i++) if (cupIndex(placeOf(after[i]!)) !== null) cup++;
  return cup;
}

/** An undo or a reset: every token that moved goes straight back, together. */
export function rewindScript(from: Tokens, to: Tokens): LedgerScript {
  const S = LEDGER_SHOW;
  const out: LedgerBeat[] = [];
  for (let i = 0; i < TOKENS; i++) {
    const a = placeOf(from[i] ?? 'h');
    const b = placeOf(to[i] ?? 'h');
    if (a !== b) out.push(beat(0, 'rewind', S.rewind, i, a, b));
  }
  if (balanced(from) !== balanced(to)) out.push(beat(S.rewind * 0.5, 'star', 0, null, null, null, null, !balanced(to)));
  return { beats: out, length: end(out) };
}

/**
 * Where each payment is at `t` seconds into a script that runs `before` → `after`: a place, or a move between two
 * places part way (`k` 0..1). For the view; and for the tests' "never half-way at rest" (the script's end is `after`).
 */
export interface TokenAt {
  readonly from: Place;
  readonly to: Place;
  readonly k: number;
  /** The beat moving it now, or null when it is still. */
  readonly kind: LedgerBeatKind | null;
}
export function tokensAt(script: LedgerScript, before: Tokens, after: Tokens, t: number): TokenAt[] {
  const out: TokenAt[] = before.map((s) => ({ from: placeOf(s), to: placeOf(s), k: 1, kind: null }));
  if (t >= script.length) return after.map((s) => ({ from: placeOf(s), to: placeOf(s), k: 1, kind: null }));
  for (const b of script.beats) {
    if (b.token === null || b.from === null || b.to === null) continue;
    if (t < b.at) continue;
    const k = b.dur <= 0 ? 1 : Math.min(1, (t - b.at) / b.dur);
    out[b.token] = k >= 1 ? { from: b.to, to: b.to, k: 1, kind: null } : { from: b.from, to: b.to, k, kind: b.kind };
  }
  return out;
}

/** Is the star lit at `t` seconds into a script that runs `before` → `after`? */
export function starAt(script: LedgerScript, before: Tokens, after: Tokens, t: number): boolean {
  if (t >= script.length) return !balanced(after);
  let on = !balanced(before);
  for (const b of script.beats) if (b.kind === 'star' && t >= b.at) on = b.on === true;
  return on;
}
