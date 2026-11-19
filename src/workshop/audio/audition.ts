/**
 * Scripts for hearing the palette in one sitting (AU1 brief § 5): a run of crates under the striker at
 * each belt speed, forwards and reversed, and a busy ten seconds of everything at once. The audition
 * page plays them; the mix test renders the busy ten seconds in Node and checks its peak.
 */
import { BELT_TUNING } from '../sim/index.ts';
import type { PartMaterial, PartSize } from '../sim/index.ts';
import type { Cue, LoopCue } from './score.ts';

export interface Timed {
  readonly at: number;
  readonly cue: Cue;
}

export interface LoopSpan {
  readonly from: number;
  readonly to: number;
  readonly loop: LoopCue;
}

export interface Script {
  readonly name: string;
  readonly seconds: number;
  readonly cues: readonly Timed[];
  readonly loops: readonly LoopSpan[];
}

const c = (id: string, o: Partial<Omit<Cue, 'id'>> = {}): Cue => ({ id, gain: 1, pan: 0, ...o });

/**
 * Three crates, small, medium and large, set close on the belt (the X2 scenario's spacing: centres
 * 0.645 and 0.82 apart), struck at the belt's speed. Forward the small one reaches the arm first (a
 * falling run); reversed the large one does (a rising run).
 */
export function run(detent: number, reversed: boolean, material: PartMaterial = 'wood'): Script {
  const v = BELT_TUNING.speeds[detent - 1] ?? 1.5;
  const gaps = reversed ? [0.82, 0.645] : [0.645, 0.82];
  const order: PartSize[] = reversed ? ['L', 'M', 'S'] : ['S', 'M', 'L'];
  const cues: Timed[] = [];
  let at = 0.4;
  order.forEach((size, i) => {
    cues.push({ at, cue: c(`note.${material}.${size}`) }, { at, cue: c('striker.felt') });
    at += (gaps[i] ?? 0) / v;
  });
  const end = at + 1.6;
  return {
    name: `${material} run, detent ${detent} (${v} u/s), ${reversed ? 'reversed (rising)' : 'forward (falling)'}`,
    seconds: end,
    cues,
    loops: [{ from: 0, to: end - 0.8, loop: { id: 'loop.hum', gain: Math.min(1, v / 0.5) * (0.7 + 0.3 * Math.min(1, v / 3)), rate: Math.min(2.2, Math.max(0.3, v / 1.5)), pan: 0 } }],
  };
}

/** A scripted burst of nearly everything in ten seconds, to hear the mix (and check its peak). */
export function busy(): Script {
  const t: Timed[] = [];
  const at = (s: number, id: string, o: Partial<Omit<Cue, 'id'>> = {}): void => void t.push({ at: s, cue: c(id, o) });
  at(0.0, 'pick.wood.L', { pan: -0.3 });
  at(0.35, 'hit.wood.L', { gain: 0.8, pan: -0.2, lowpass: 9000 });
  at(0.5, 'handle.lever', { pan: -0.15 });
  for (const s of [0.65, 0.8, 0.95]) at(s, 'handle.dial', { pan: -0.15, rate: 1 + (s - 0.65) / 3 });
  for (const [s, size] of [[1.1, 'S'], [1.5, 'M'], [2.0, 'L']] as const) {
    at(s, `note.wood.${size}`, { pan: 0.1 });
    at(s, 'striker.felt', { pan: 0.1 });
  }
  at(2.2, 'dock.open', { pan: 0.28 });
  at(2.55, 'dock.bell', { pan: 0.28 });
  at(2.95, 'dock.close', { pan: 0.28 });
  at(3.0, 'plug.out', { pan: -0.06 });
  at(3.4, 'plug.seat', { pan: 0.07 });
  at(3.42, 'relay.tick', { pan: 0.2 });
  at(3.6, 'phone.tick', { pan: 0.1 });
  at(4.4, 'phone.buzz', { pan: 0.1 });
  at(4.5, 'card.slip', { pan: 0.1 });
  at(5.0, 'button.clunk');
  at(5.0, 'rung.flinch');
  at(5.02, 'rung.shake');
  at(5.15, 'rung.works');
  at(5.15, 'rung.sparks');
  [0.0, 0.07, 0.15, 0.2, 0.31, 0.4, 0.55].forEach((d, i) => at(5.3 + d, `hit.wood.${(['L', 'M', 'S'] as const)[i % 3]}`, { gain: 1 - i * 0.12, pan: -0.25 + i * 0.03, lowpass: 12000 - i * 1200 }));
  at(5.6, 'crew.bonk', { pan: 0.05 });
  at(6.0, 'undo.latch', { pan: -0.1 });
  at(6.1, 'undo.thunk', { pan: -0.1 });
  at(6.1, 'tape.rewind', { param: 1.0 });
  at(6.62, 'undo.home', { pan: -0.1 });
  at(6.9, 'dock.beep', { pan: 0.28 });
  at(7.3, 'chute.thump', { pan: -0.34 });
  at(7.3, 'chute.flap', { pan: -0.34 });
  for (const [s, size] of [[7.6, 'S'], [7.85, 'M'], [8.1, 'L']] as const) at(s, `note.metal.${size}`, { pan: 0.1 });
  at(8.4, 'patch.bonk', { pan: 0.0 });
  at(8.6, 'revert.hatch', { pan: -0.1 });
  for (let i = 0; i < 10; i++) at(8.8 + i * 0.087, 'revert.ratchet', { pan: -0.1 });
  at(9.2, 'revert.sweep', { pan: -0.1 });
  at(9.5, 'tell.tick', { pan: 0.2 });
  at(9.65, 'mailbox.flag', { pan: 0.1 });
  at(9.8, 'cover.snap', { pan: 0 });
  // R1: the chute's delivery, Fetch startled and lifted, Patch lifted
  at(3.7, 'chute.launch', { pan: -0.34 });
  at(3.7, 'chute.flap', { pan: -0.34 });
  at(4.9, 'hit.wood.M', { gain: 0.6, pan: -0.3, lowpass: 8000 });
  at(5.0, 'fetch.chirp', { pan: 0.05 });
  at(8.95, 'fetch.yelp', { pan: 0.05 });
  at(10.2, 'patch.yelp', { pan: 0.15 });
  return {
    name: 'a busy ten seconds',
    seconds: 11,
    cues: t.sort((a, b) => a.at - b.at),
    loops: [
      { from: 0, to: 10, loop: { id: 'loop.hum', gain: 1, rate: 1, pan: 0 } },
      { from: 1.0, to: 3.2, loop: { id: 'loop.wheel', gain: 1, rate: 1, pan: -0.1 } },
      { from: 8.5, to: 9.6, loop: { id: 'loop.treads', gain: 1, rate: 1, pan: -0.1 } },
    ],
  };
}
