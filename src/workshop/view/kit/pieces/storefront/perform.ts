/**
 * The five changes, performed. Each is a pure function of where it starts,
 * where it ends and t (0..1): the view drives t from the simulation clock,
 * and running t from 1 back to 0 (or swapping start and end) is the undo.
 * Nothing here keeps state; nothing here knows why a change happens.
 *
 *  1. fascia colour  `fasciaColour(o, from, to, t)`: a brush wipes the new
 *     paint across from left to right, a ragged wet edge leading.
 *  2. fascia words   `fasciaWordsTurn(o, turnsFrom, t)`: paint the new words
 *     on the face turned away first (labels.ts `setFasciaWords` on
 *     `hiddenFace(turnsFrom)`), then the slats turn over one after another
 *     from the top, each thrown over by its spring.
 *  3. awning colour  `awningColour(o, from, to, t)`: the winder turns, the
 *     awning rolls up into its hood (0..0.45), the new canvas is on the
 *     roller (0.5), it rolls out again (0.55..1).
 *  4. open / closed  `openClosed(o, fromOpen, toOpen, t)`: the card turns half
 *     round on its string, swings past and settles; the window's light
 *     stutters and goes out as it turns (or stutters on).
 *  5. the picture    `pictureRoll(o, from, to, t)`: the drum rolls forward,
 *     face after face, to the new picture (always forward: "next" order).
 */
import type { Object3D } from 'three';
import type { Token } from '../../types.ts';
import { paintAwning, wipeFascia } from './recolour.ts';
import { overshoot, poseStorefront, wordsFace } from './pose.ts';
import { PICTURE } from './dims.ts';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** 1. The fascia's paint, part-way through a repaint. */
export function fasciaColour(o: Object3D, from: Token, to: Token, t: number): void {
  wipeFascia(o, from, to, smooth(t));
}

/** The face to paint new words on before turning from `turns` (the one turned away). */
export function hiddenFace(turns: number): 'A' | 'B' {
  return wordsFace(turns) === 'A' ? 'B' : 'A';
}

/** 2. The slats turning over, from `turnsFrom` (a whole number) to turnsFrom + 1. */
export function fasciaWordsTurn(o: Object3D, turnsFrom: number, t: number): void {
  poseStorefront(o, { words: turnsFrom + clamp01(t) });
}

/** The awning's extension during a colour change (in, swap, out). */
export function awningCycle(t: number): number {
  const x = clamp01(t);
  if (x < 0.45) return 1 - smooth(x / 0.45);
  if (x < 0.55) return 0;
  return smooth((x - 0.55) / 0.45);
}

/** 3. The awning's colour change: roll in, swap the canvas at the roller, roll out. */
export function awningColour(o: Object3D, from: Token, to: Token, t: number): void {
  poseStorefront(o, { awning: awningCycle(t) });
  paintAwning(o, t < 0.5 ? from : to);
}

/** The window light during a change from lit to dark (deterministic stutter); reversed for dark to lit. */
export function lightStutter(t: number): number {
  // on, a flicker off, on, off, a last gasp, off
  const steps: Array<[number, number]> = [[0.3, 1], [0.36, 0], [0.42, 1], [0.5, 0], [0.55, 1], [0.6, 0]];
  let v = 1;
  for (const [at, val] of steps) if (t >= at) v = val;
  return v;
}

/** 4. OPEN to CLOSED (or back): the card turns with a swing; the light follows. */
export function openClosed(o: Object3D, fromOpen: boolean, toOpen: boolean, t: number): void {
  const x = clamp01(t);
  if (fromOpen === toOpen) {
    poseStorefront(o, { open: toOpen ? 1 : 0 });
    return;
  }
  // the card: from one face to the other, overshooting and swinging back on its string
  const turn = overshoot(x / 0.85, 0.12);
  const open = fromOpen ? 1 - turn : turn;
  const lights = fromOpen ? lightStutter(x) : 1 - lightStutter(1 - x);
  poseStorefront(o, { open, lights });
}

/** 5. The drum rolling forward from face `from` to face `to` (0..5; wraps forward). */
export function pictureRoll(o: Object3D, from: number, to: number, t: number): void {
  const n = PICTURE.faces;
  let steps = (((to - from) % n) + n) % n;
  if (steps === 0 && from !== to) steps = n;
  poseStorefront(o, { picture: from + steps * overshoot(t, 0.06) });
}
