// P3 S1: the opening of a fresh bench, step for step, as a fingerprint (the loading pictures and many tests depend on
// it). `opening.test.ts` holds a fresh world to the fingerprint recorded from `rewrite` before tells, the snapshot and
// reduced motion were built (`opening-fingerprint.json`), and proves each of them leaves it alone when unused.
import { createHash } from 'node:crypto';
import { benchWorld, FULL_BENCH } from './line-helpers.ts';
import type { World, WorldOptions } from '../../src/workshop/sim/world.ts';

/** The bench page's own seed and scene (src/dev-pages/bench.astro: `?seed` defaults to 1, the whole bench). */
export const OPENING_SEED = 1;
/** The pictures' step (src/dev-pages/bench/posters.json: `step` 12, then `settle` 2). */
export const PICTURE_STEP = 14;
/** How far the fingerprint runs: two minutes: the first laps of attract mode. */
export const OPENING_STEPS = 7200;
/** A checkpoint every this many steps, so a difference says where it began. */
export const CHECK_EVERY = 300;

export const openingWorld = (opts: Partial<WorldOptions> = {}): Promise<World> => benchWorld(OPENING_SEED, { scene: FULL_BENCH, ...opts });

/** Everything a step leaves that anyone could see: every body, every durable field and writer, the crew, the machines, the events. */
export function stateOf(w: World, events: readonly unknown[]): string {
  const bodies = [...w.parts()].map((p) => {
    const m = w.motion(p.id)!;
    return [p.id, m.mode, m.pose.p, m.pose.q, m.awake];
  });
  const machines = [...w.interactables()].map((i) => w.machine(i.id) ?? null);
  return JSON.stringify({
    step: w.step,
    playMode: w.playMode,
    bodies,
    durable: w.durable(),
    crew: w.crewViews(),
    attract: { ...w.attract(), timeline: undefined },
    button: (({ rung, reached, presses, phase, cover, used, deck, reducedMotion }) => ({ rung, reached, presses, phase, cover, used, deck, reducedMotion }))(w.button()),
    machines,
    holding: w.holding(),
    stack: w.undoStack(),
    events,
  });
}

export interface Fingerprint {
  /** The exact state at the pictures' step. */
  readonly picture: string;
  /** A running hash after each checkpoint (every step's state goes into it). */
  readonly checkpoints: readonly { readonly step: number; readonly hash: string }[];
}

/** Step a fresh world `n` steps, every step's state into the running hash. */
export function fingerprint(w: World, n = OPENING_STEPS): Fingerprint {
  const h = createHash('sha256');
  let picture = '';
  const checkpoints: { step: number; hash: string }[] = [];
  for (let i = 0; i < n; i++) {
    w.advance();
    const s = stateOf(w, w.drainEvents());
    h.update(s);
    if (w.step === PICTURE_STEP) picture = createHash('sha256').update(s).digest('hex');
    if (w.step % CHECK_EVERY === 0) checkpoints.push({ step: w.step, hash: h.copy().digest('hex') });
  }
  return { picture, checkpoints };
}
