/**
 * The Big Red Button (REWRITE.md § B4), rung 1 only: "The flinch". The
 * bracket of § E5 is real here because P2's rungs reuse it: at the press the
 * world snapshots every durable field and every body; while the rung plays
 * nothing commits and the poses are recorded; then the recording plays
 * backwards and the snapshot is restored exactly.
 *
 * The rung and the press count are the Button's own and are not in the
 * history (§ E5 rule 13); they are the only things a rung changes.
 */
import type { ButtonView, Id, Intent, RungPhase, Vec3 } from '../types.ts';
import type { SimContext, Unit } from '../context.ts';
import { HZ, steps } from '../clock.ts';

/** Timings in seconds; tune here. */
export const BUTTON_TUNING = {
  /** Rung 1 plays this long before it rewinds (§ B4: 3 s). */
  flinch: 3,
  /** The rewind (~1.2 s). */
  rewind: 1.2,
} as const;

export type { ButtonView, RungPhase } from '../types.ts';

export interface ButtonUnit extends Unit {
  view(): ButtonView;
}

/** The content id of a rung's card. */
export const cardFor = (rung: number): string => `card.rung${rung}`;

export function createButton(ctx: SimContext, saved?: { rung: number; presses: number }): ButtonUnit {
  const spec = ctx.scene.button;
  let presses = saved?.presses ?? 0;
  let rung = saved?.rung ?? 0;
  let phase: RungPhase = 'idle';
  let phaseStart = 0;
  const rng = ctx.rng('button');

  ctx.register({
    id: spec.id,
    station: 'button',
    name: spec.name,
    affordances: ['press'],
    tell: () => ctx.emit({ type: 'tell', id: spec.id }),
    misfire: (level) => ctx.emit({ type: 'misfire', id: spec.id, level }),
  });

  const enter = (p: RungPhase): void => {
    phase = p;
    phaseStart = ctx.clock.step;
  };

  /** The next rung on the ladder. P1 has rung 1 only; later presses replay it. */
  const nextRung = (): number => 1;

  function flinch(): void {
    for (const id of spec.flinch) ctx.interactable(id)?.misfire(1);
    // one crate slides off the stack: the highest one still free
    let top: Id | null = null;
    let topY = -Infinity;
    for (const id of spec.stack) {
      if (ctx.mode(id) !== 'free') continue;
      const y = ctx.pose(id)?.p[1] ?? -Infinity;
      if (y > topY) [top, topY] = [id, y];
    }
    if (top !== null) {
      const jitter = rng.range(0.9, 1.1);
      const dv: Vec3 = [spec.shove[0] * jitter, spec.shove[1], spec.shove[2] * jitter];
      ctx.shove(top, dv);
    }
  }

  return {
    id: spec.id,
    intent(intent: Intent): boolean {
      if (intent.type !== 'press' || intent.id !== spec.id) return false;
      if (ctx.bracketed || ctx.holding() !== null) return false;
      presses += 1;
      rung = nextRung();
      ctx.emit({ type: 'handle.worked', id: spec.id });
      ctx.emit({ type: 'button.pressed', rung, presses });
      ctx.beginBracket();
      ctx.emit({ type: 'rung.started', rung, duration: BUTTON_TUNING.flinch });
      enter('playing');
      flinch();
      return true;
    },
    pre() {
      const t = ctx.clock.step - phaseStart;
      if (phase === 'playing' && t >= steps(BUTTON_TUNING.flinch)) {
        ctx.emit({ type: 'rung.rewinding', rung, duration: BUTTON_TUNING.rewind });
        ctx.beginRewind(steps(BUTTON_TUNING.rewind));
        enter('rewinding');
      }
    },
    post() {
      // the last rewind frame has just been shown: restore the snapshot exactly, so the
      // world at the end of this step is the world before the press
      if (phase === 'rewinding' && ctx.clock.step - phaseStart + 1 >= steps(BUTTON_TUNING.rewind)) {
        ctx.endBracket();
        ctx.emit({ type: 'rung.ended', rung });
        ctx.emit({ type: 'card', by: spec.cardBy, content: cardFor(rung) });
        enter('idle');
      }
    },
    view: () => ({ id: spec.id, rung, presses, phase, phaseTime: (ctx.clock.step - phaseStart) / HZ }),
  };
}
