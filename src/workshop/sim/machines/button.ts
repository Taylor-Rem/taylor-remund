/**
 * The Big Red Button (REWRITE.md § B4): one joke per press, four rungs, then
 * a deck, and the bench always put back exactly.
 *
 * Every rung is bracketed (§ E5 "The Button is bracketed"): at the press the
 * world snapshots every durable field and every body; while the rung plays
 * nothing commits and the poses are recorded; then the recording plays
 * backwards and the snapshot is restored exactly. The rung, the press count,
 * the cover, the deck and what the visitor has used are the Button's own
 * and are not in the history (§ E5 rule 13); they are the only things a
 * press changes.
 *
 * The ladder (each rung's beats are data: `scriptFor`, published as
 * `ButtonView.script` and as `rung.beat` events in the step each falls due):
 * 1. The flinch (3 s): the lamp dips, the belt lurches back, the top crate
 *    slides off the stack, the crew freezes; Revert is called; the rewind.
 * 2. The hiccup (4 s): as rung 1, and the nearest station the visitor has
 *    not used misfires once.
 * 3. The cover (4 s): the lamp dips; a different unused station misfires;
 *    the rewind; then Revert fits a flip-up cover over the Button (outside
 *    the bracket: the cover is the Button's own state). From then on a press
 *    on a shut cover lifts it (one click, at once; never a refusal) and the
 *    next press plays; after every rung the cover drops shut again.
 * 4. The works (7 s): every station the visitor has used misfires together,
 *    harder; sparks, a turning warning lamp, a small shake; the crate stack
 *    comes down; then the whole bench runs backwards to how it was.
 * After: each press draws a card from a shuffled deck of six (two for each
 * of rungs 2, 3 and 4, each with its own line for Revert), never the same
 * card twice running; reshuffled when it runs out.
 *
 * With reduced motion a rung is the lamp dip and the card only: nothing is
 * shoved, nothing misfires but the lamp, Revert is not called.
 */
import type { ButtonView, CoverState, Id, Intent, RungBeat, RungPhase, RungScript, SimEvent, Vec3 } from '../types.ts';
import type { SimContext, Unit } from '../context.ts';
import type { LadderSpec } from '../scene.ts';
import { HZ, steps } from '../clock.ts';
import { createUsed } from '../used.ts';

/** Timings in seconds; tune here. */
export const BUTTON_TUNING = {
  /** Rung 1 plays this long before it rewinds (§ B4: 3 s). */
  flinch: 3,
  /** Rung 1's rewind (~1.2 s). */
  rewind: 1.2,
  /** Each rung: how long it plays, and its rewind (§ B4: rung 2 "4 s"; rung 4 "7 s" in all, the run backwards included). */
  rungs: {
    1: { play: 3, rewind: 1.2 },
    2: { play: 4, rewind: 1.2 },
    3: { play: 4, rewind: 1.2 },
    4: { play: 5, rewind: 2 },
  } as Readonly<Record<1 | 2 | 3 | 4, { readonly play: number; readonly rewind: number }>>,
  /** Rung 2's hiccup lands after the flinch has (the crate is still sliding). */
  hiccupAt: 1.1,
  /** Rung 3 has no flinch: its misfire comes almost at once. */
  coverHiccupAt: 0.6,
  /** Rung 4: the used stations misfire, the stack comes down a beat later, the warning lamp turns until the rewind. */
  works: { misfire: 0.15, stack: 0.45, warning: 4.6 },
  /** How long the cover takes to be fitted after rung 3: Revert's trip from its hatch and the screwing. A press meanwhile is not refused: it plays, and the fitting carries on after. */
  fit: 6.5,
  /** Reduced motion: the dip, then the card. */
  reduced: { play: 0.9, rewind: 0.3 },
  /** Rung 4's stack: each crate leaves the stack's middle at this speed (units/s), and this fast upward. */
  stackOut: [1.4, 2.6] as readonly [number, number],
  stackUp: [1.2, 2.4] as readonly [number, number],
} as const;

export type { ButtonView, RungPhase } from '../types.ts';

/** The deck after the ladder (§ B4 "a deck of six"): two cards for each of rungs 2 to 4, each with its own line. */
export const DECK: readonly { readonly id: Id; readonly rung: 2 | 3 | 4; readonly card: string }[] = [
  { id: 'deck-1', rung: 2, card: 'card.deck.1' },
  { id: 'deck-2', rung: 2, card: 'card.deck.2' },
  { id: 'deck-3', rung: 3, card: 'card.deck.3' },
  { id: 'deck-4', rung: 3, card: 'card.deck.4' },
  { id: 'deck-5', rung: 4, card: 'card.deck.5' },
  { id: 'deck-6', rung: 4, card: 'card.deck.6' },
];

/** What a visit remembers of the Button (§ B4: "the rung reached is remembered between visits"). */
export interface ButtonSaved {
  /** The rung last played (older saves: the rung reached). */
  readonly rung: number;
  readonly presses: number;
  /** The highest rung of the ladder reached; defaults to `rung`. */
  readonly reached?: number;
  readonly cover?: CoverState;
  readonly used?: readonly Id[];
  readonly deck?: { readonly left: readonly Id[]; readonly last: Id | null };
  /** Rungs are the card and the lamp dip only. */
  readonly reducedMotion?: boolean;
}

export interface ButtonUnit extends Unit {
  view(): ButtonView;
  /** S6: reduced motion at run time: from the next press a rung is the card and the lamp dip only. */
  setReducedMotion(on: boolean): void;
}

/** The content id of a ladder rung's card. */
export const cardFor = (rung: number): string => `card.rung${rung}`;

/** A rung as data: its beats in time order (the simulation does the ones that move things; the view performs the rest). */
export function scriptFor(rung: 1 | 2 | 3 | 4, reduced = false): RungScript {
  const T = BUTTON_TUNING;
  const beats: RungBeat[] = [];
  if (reduced) {
    const { play, rewind } = T.reduced;
    beats.push({ at: 0, kind: 'dip', level: 1 }, { at: play, kind: 'rewind', duration: rewind }, { at: play + rewind, kind: 'card' });
    if (rung === 3) beats.push({ at: play + rewind, kind: 'cover', duration: 0 });
    return { rung, play, rewind, beats, reduced: true };
  }
  const { play, rewind } = T.rungs[rung];
  if (rung === 1 || rung === 2) beats.push({ at: 0, kind: 'flinch', level: 1 }, { at: 0, kind: 'shove' });
  else if (rung === 3) beats.push({ at: 0, kind: 'dip', level: 1 });
  else beats.push({ at: 0, kind: 'dip', level: 2 }, { at: 0, kind: 'shake', level: 2 }, { at: 0, kind: 'warning', duration: T.works.warning });
  beats.push({ at: 0, kind: 'revert' });
  if (rung === 2) beats.push({ at: T.hiccupAt, kind: 'hiccup', level: 1 });
  if (rung === 3) beats.push({ at: T.coverHiccupAt, kind: 'hiccup', level: 1 });
  if (rung === 4) beats.push({ at: T.works.misfire, kind: 'works', level: 2 }, { at: T.works.misfire, kind: 'sparks', level: 2 }, { at: T.works.stack, kind: 'stack', level: 2 });
  beats.push({ at: play, kind: 'rewind', duration: rewind }, { at: play + rewind, kind: 'card' });
  if (rung === 3) beats.push({ at: play + rewind, kind: 'cover', duration: T.fit });
  return { rung, play, rewind, beats, reduced: false };
}

/** Every rung's script, full motion (for the view and the tests). */
export const RUNG_SCRIPTS: Readonly<Record<1 | 2 | 3 | 4, RungScript>> = { 1: scriptFor(1), 2: scriptFor(2), 3: scriptFor(3), 4: scriptFor(4) };

const asRung = (n: number): 1 | 2 | 3 | 4 => (n <= 1 ? 1 : n >= 4 ? 4 : (n as 2 | 3));

export function createButton(ctx: SimContext, saved?: ButtonSaved): ButtonUnit {
  const spec = ctx.scene.button;
  const ladder: LadderSpec | undefined = spec.ladder;
  let reduced = saved?.reducedMotion === true;
  const lampId: Id = ladder?.lamp ?? spec.flinch[0] ?? 'lamp';
  const coverId: Id = ladder?.cover ?? `${spec.id}-cover`;
  /** Where each station is; without a ladder, the flinch's (all at the Button: equally near). */
  const stations: readonly { readonly id: Id; readonly at: Vec3 }[] = ladder?.stations ?? spec.flinch.map((id) => ({ id, at: spec.at }));
  const used = createUsed(ctx, stations.map((s) => s.id), { lever: ladder?.lever ?? null, cord: ladder?.cord ?? null, line: ladder?.line ?? null, saved: saved?.used });

  let presses = saved?.presses ?? 0;
  let rung = saved?.rung ?? 0;
  let reached = Math.min(4, Math.max(0, saved?.reached ?? rung));
  let phase: RungPhase = 'idle';
  let phaseStart = 0;
  let script: RungScript | null = null;
  let card: string | null = null;
  let targets: Id[] = [];
  let beatsDone = 0;
  /** The station rung 2 (or the last hiccup) misfired: rung 3's must be a different one. */
  let lastHiccup: Id | null = null;
  let cover: CoverState = saved?.cover === 'shut' || saved?.cover === 'open' || saved?.cover === 'fitting' ? 'shut' : 'none';
  let coverAt = 0;
  const known = new Set(DECK.map((c) => c.id));
  let deckLeft: Id[] = (saved?.deck?.left ?? []).filter((id) => known.has(id));
  let deckLast: Id | null = saved?.deck?.last !== undefined && saved.deck.last !== null && known.has(saved.deck.last) ? saved.deck.last : null;
  const rng = ctx.rng('button');

  ctx.register({
    id: spec.id,
    station: 'button',
    name: spec.name,
    affordances: ['press'],
    tell: () => ctx.emit({ type: 'tell', id: spec.id }),
    misfire: (level) => ctx.emit({ type: 'misfire', id: spec.id, level }),
  });
  if (ladder) {
    ctx.register({
      id: coverId,
      station: 'button',
      name: ladder.coverName,
      affordances: ['open'],
      tell: () => ctx.emit({ type: 'tell', id: coverId }),
      misfire: (level) => ctx.emit({ type: 'misfire', id: coverId, level }),
    });
  }

  const enter = (p: RungPhase): void => {
    phase = p;
    phaseStart = ctx.clock.step;
  };
  const setCover = (c: CoverState): void => {
    if (c === cover) return;
    cover = c;
    coverAt = ctx.clock.step;
    ctx.emit({ type: 'cover', id: coverId, state: c });
  };
  const flat = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const nearestFirst = (ids: readonly Id[]): Id[] =>
    stations
      .filter((s) => ids.includes(s.id))
      .map((s, i) => ({ id: s.id, d: flat(s.at, spec.at), i }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .map((s) => s.id);
  const live = (id: Id): boolean => ctx.interactable(id) !== undefined;

  /** Rungs 2 and 3: one station the visitor has not used (not the lamp, not the flinch's, not the last hiccup's), nearest first. */
  function hiccupTarget(): Id[] {
    const pool = stations.map((s) => s.id).filter((id) => live(id) && id !== lampId && !spec.flinch.includes(id) && id !== lastHiccup);
    const fresh = nearestFirst(pool.filter((id) => !used.has(id)));
    const pick = fresh[0] ?? nearestFirst(pool)[0];
    return pick === undefined ? [] : [pick];
  }

  /** Draw the next card after the ladder: never the one drawn last. */
  function draw(): (typeof DECK)[number] {
    if (deckLeft.length === 0) {
      const ids = DECK.map((c) => c.id);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [ids[i], ids[j]] = [ids[j] as Id, ids[i] as Id];
      }
      if (ids[0] === deckLast && ids.length > 1) [ids[0], ids[1]] = [ids[1] as Id, ids[0] as Id];
      deckLeft = ids;
    }
    const id = deckLeft.shift() as Id;
    deckLast = id;
    return DECK.find((c) => c.id === id) as (typeof DECK)[number];
  }

  // ── what the beats do (the ones that move things; the view performs the rest) ──
  const misfire = (id: Id, level: 1 | 2): void => ctx.interactable(id)?.misfire(level);

  /** The top crate that is still free slides off the stack (rung 1, as built in P1). */
  function shoveTop(): Id[] {
    let top: Id | null = null;
    let topY = -Infinity;
    for (const id of spec.stack) {
      if (ctx.mode(id) !== 'free') continue;
      const y = ctx.pose(id)?.p[1] ?? -Infinity;
      if (y > topY) [top, topY] = [id, y];
    }
    if (top === null) return [];
    const jitter = rng.range(0.9, 1.1);
    ctx.shove(top, [spec.shove[0] * jitter, spec.shove[1], spec.shove[2] * jitter]);
    return [top];
  }

  /** Rung 4: every free crate standing on the stack comes down, outward and toward the visitor. */
  function stackDown(): Id[] {
    const T = BUTTON_TUNING;
    const [sx, sz] = ladder?.stackAt ?? [ctx.pose(spec.stack[0] ?? '')?.p[0] ?? 0, ctx.pose(spec.stack[0] ?? '')?.p[2] ?? 0];
    const radius = ladder?.stackRadius ?? 0.6;
    const out: Id[] = [];
    for (const id of ctx.parts()) {
      if (ctx.mode(id) !== 'free' || ctx.part(id)?.kind !== 'crate') continue;
      const p = ctx.pose(id)?.p;
      if (!p || Math.hypot(p[0] - sx, p[2] - sz) > radius) continue;
      out.push(id);
    }
    out.sort((a, b) => (ctx.pose(b)?.p[1] ?? 0) - (ctx.pose(a)?.p[1] ?? 0));
    // it topples onto the bench, never off it: toward the bench's middle, fanned, and a little toward the visitor
    const b = ctx.scene.bench;
    const inward = Math.atan2((b.minZ + b.maxZ) / 2 - sz, (b.minX + b.maxX) / 2 - sx);
    out.forEach((id, i) => {
      const turn = inward + rng.range(-0.7, 0.7);
      const dx = Math.cos(turn);
      const dz = Math.sin(turn) + 0.3;
      const n = Math.hypot(dx, dz);
      // the higher the crate, the further it goes
      const v = rng.range(T.stackOut[0], T.stackOut[1]) * (1 + 0.25 * (out.length - 1 - i));
      ctx.shove(id, [(dx / n) * v, rng.range(T.stackUp[0], T.stackUp[1]), (dz / n) * v]);
    });
    return out;
  }

  function fire(beat: RungBeat): void {
    let ids: Id[] = [];
    const level = beat.level ?? 1;
    switch (beat.kind) {
      case 'flinch':
        ids = [...spec.flinch];
        break;
      case 'dip':
        ids = [lampId];
        break;
      case 'revert':
        ids = [spec.cardBy];
        break;
      case 'hiccup':
      case 'works':
      case 'sparks':
        ids = targets;
        break;
      default:
        break;
    }
    if (beat.kind === 'shove') ids = shoveTop();
    if (beat.kind === 'stack') ids = stackDown();
    ctx.emit({ type: 'rung.beat', rung, beat: beat.kind, ids, level, duration: beat.duration ?? 0 });
    if (beat.kind === 'flinch' || beat.kind === 'dip' || beat.kind === 'hiccup' || beat.kind === 'works') for (const id of ids) misfire(id, level);
  }

  /** Fire every beat due by `t` seconds into the rung (the rewind, the card and the cover are the transitions'). */
  function due(t: number): void {
    const beats = script?.beats ?? [];
    while (beatsDone < beats.length) {
      const b = beats[beatsDone] as RungBeat;
      if (b.kind === 'rewind' || b.kind === 'card' || b.kind === 'cover') break;
      if (steps(b.at) > t) break;
      beatsDone += 1;
      fire(b);
    }
  }

  function press(): void {
    presses += 1;
    let next: { rung: 1 | 2 | 3 | 4; card: string };
    if (reached < 4) {
      reached += 1;
      next = { rung: asRung(reached), card: cardFor(reached) };
    } else {
      const c = draw();
      next = { rung: c.rung, card: c.card };
    }
    rung = next.rung;
    card = next.card;
    script = scriptFor(next.rung, reduced);
    targets = reduced ? [] : rung === 2 || rung === 3 ? hiccupTarget() : rung === 4 ? nearestFirst(stations.map((s) => s.id).filter((id) => used.has(id) && live(id))) : [];
    if ((rung === 2 || rung === 3) && targets[0] !== undefined) lastHiccup = targets[0];
    beatsDone = 0;
    ctx.emit({ type: 'handle.worked', id: spec.id });
    ctx.emit({ type: 'button.pressed', rung, presses });
    ctx.beginBracket();
    ctx.emit({ type: 'rung.started', rung, duration: script.play });
    enter('playing');
    due(0);
  }

  function ended(): void {
    ctx.endBracket();
    ctx.emit({ type: 'rung.ended', rung });
    const s = script as RungScript;
    const t = s.play + s.rewind;
    ctx.emit({ type: 'rung.beat', rung, beat: 'card', ids: [spec.cardBy], level: 1, duration: 0 });
    ctx.emit({ type: 'card', by: spec.cardBy, content: card ?? cardFor(rung) });
    const fit = s.beats.find((b) => b.kind === 'cover' && b.at <= t + 1e-9);
    if (fit) {
      ctx.emit({ type: 'rung.beat', rung, beat: 'cover', ids: [coverId], level: 1, duration: fit.duration ?? 0 });
      setCover((fit.duration ?? 0) > 0 ? 'fitting' : 'shut');
    } else if (cover === 'open') setCover('shut'); // the cover drops back after every rung
    enter('idle');
  }

  return {
    id: spec.id,
    setReducedMotion(on) {
      reduced = on;
    },
    intent(intent: Intent): boolean {
      // the Button is the first unit: it sees every handle's intent (what the visitor has used)
      if (!ctx.bracketed) used.intent(intent);
      if (intent.type !== 'press' || (intent.id !== spec.id && intent.id !== coverId)) return false;
      if (ctx.bracketed || ctx.holding() !== null) return false;
      if (intent.id === coverId) {
        if (cover === 'shut') setCover('open');
        else if (cover === 'open') setCover('shut');
        else return false;
        ctx.emit({ type: 'handle.worked', id: coverId });
        return true;
      }
      // while it is being fitted there is no cover to lift yet: a press plays (never a dead Button)
      if (cover === 'shut') {
        // a press on a shut cover lifts it (at once, one click): the next press plays
        setCover('open');
        ctx.emit({ type: 'handle.worked', id: coverId });
        return true;
      }
      press();
      return true;
    },
    pre() {
      const t = ctx.clock.step - phaseStart;
      if (phase === 'playing') {
        due(t);
        const s = script as RungScript;
        if (t >= steps(s.play)) {
          ctx.emit({ type: 'rung.rewinding', rung, duration: s.rewind });
          ctx.emit({ type: 'rung.beat', rung, beat: 'rewind', ids: [], level: 1, duration: s.rewind });
          ctx.beginRewind(steps(s.rewind));
          enter('rewinding');
        }
      }
      if (cover === 'fitting' && ctx.clock.step - coverAt >= steps(BUTTON_TUNING.fit)) setCover('shut');
    },
    post() {
      // the last rewind frame has just been shown: restore the snapshot exactly, so the
      // world at the end of this step is the world before the press
      if (phase === 'rewinding' && ctx.clock.step - phaseStart + 1 >= steps((script as RungScript).rewind)) ended();
    },
    heard(events: readonly SimEvent[]) {
      used.heard(events);
    },
    reset() {
      // "Reset the workshop" starts the Button over (§ B4); never called mid-rung (the world refuses)
      presses = 0;
      rung = 0;
      reached = 0;
      script = null;
      card = null;
      targets = [];
      beatsDone = 0;
      lastHiccup = null;
      deckLeft = [];
      deckLast = null;
      used.reset();
      setCover('none');
      enter('idle');
    },
    view: () => ({
      id: spec.id,
      rung,
      reached,
      presses,
      phase,
      phaseTime: (ctx.clock.step - phaseStart) / HZ,
      script,
      card,
      targets,
      cover,
      coverTime: (ctx.clock.step - coverAt) / HZ,
      coverId,
      used: used.list(),
      deck: { left: [...deckLeft], last: deckLast },
      reducedMotion: reduced,
    }),
  };
}
