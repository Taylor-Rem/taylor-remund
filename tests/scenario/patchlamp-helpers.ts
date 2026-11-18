// Helpers for the Patchlamp station's scenarios (S3) on the whole bench under real Rapier.
import type { World } from '../../src/workshop/sim/world.ts';
import type { Id, LampView, LineView, PatchView, PlatenView, SimEvent, StorefrontView, Vec3 } from '../../src/workshop/sim/types.ts';
import type { Tape } from './line-helpers.ts';
import { PATCHLAMP } from '../../src/workshop/sim/scenes/bench.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { renderReply } from '../../src/content/texts.ts';

export { PATCHLAMP };

export const lineView = (w: World): LineView => w.machine('line') as LineView;
export const patchView = (w: World): PatchView => w.machine('patch') as PatchView;
export const platenView = (w: World): PlatenView => w.machine('platen') as PlatenView;
export const shopView = (w: World): StorefrontView => w.machine('storefront') as StorefrontView;
export const lampView = (w: World): LampView => w.machine('lamp') as LampView;

/** The answer to text `n`: a reply or a refusal event. */
export type Answer = Extract<SimEvent, { type: 'line.reply' | 'line.refused' }>;

/** Send a text (handled in the next step). Returns its number. */
export function send(w: World, t: Tape, text: string): number {
  w.dispatch({ type: 'text', text });
  t.run(1);
  const sent = t.of('line.sent').at(-1);
  if (!sent || sent.e.text !== text) throw new Error(`text ${JSON.stringify(text)} did not go down the line`);
  return sent.e.n;
}

/** Run until text `n` is answered (or `max` seconds). */
export function answer(t: Tape, n: number, max = 12): { step: number; e: Answer } {
  const done = (e: SimEvent): boolean => (e.type === 'line.reply' || e.type === 'line.refused') && e.n === n;
  const seen = t.events.find((x) => done(x.e));
  if (seen) return seen as { step: number; e: Answer };
  const got = t.until(done, Math.round(max * HZ));
  if (!got) throw new Error(`text ${n} was not answered in ${max} s`);
  return got as { step: number; e: Answer };
}

/** Text and wait for the answer; returns the answer and its words as the phone shows them. */
export function textAndWait(w: World, t: Tape, text: string): { n: number; e: Answer; words: string; seconds: number } {
  const from = w.step;
  const n = send(w, t, text);
  const a = answer(t, n);
  return { n, e: a.e, words: renderReply(a.e.reply), seconds: (a.step - from) / HZ };
}

/** Move the cord's plug to `jack` (unplug and plug, one step each). */
export function plug(w: World, t: Tape, jack: Id): SimEvent[] {
  w.dispatch({ type: 'unplug', cord: 'cord' });
  const a = t.run(1);
  w.dispatch({ type: 'plug', cord: 'cord', jack });
  return [...a, ...t.run(1)];
}

/** Run until Patch is in `state` (or `max` seconds). */
export function untilPatch(w: World, t: Tape, state: PatchView['state'], max = 6): boolean {
  for (let i = 0; i < max * HZ; i++) {
    if (patchView(w).state === state) return true;
    t.run(1);
  }
  return patchView(w).state === state;
}

/** The platen's tray seat, from the scene. */
export const traySpot = (): Vec3 => PATCHLAMP.seat;
