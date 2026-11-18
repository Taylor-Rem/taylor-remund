/**
 * One painting job, as plain data: what the main thread hands a worker (or
 * paints itself). The plan is made on the main thread (it needs the text
 * metrics and decides the label's size); the job carries the generator's
 * state where the plan left it, so the painter draws exactly the picture it
 * would have drawn had it carried straight on.
 */
import type { Token } from '../palette.ts';
import type { Painted } from './draw.ts';
import { paintPaper, paintPlate, paintSign, paintStencil, paintTape } from './draw.ts';
import type { Plan, TapeColour } from './layout.ts';
import { rng } from './rng.ts';

/** The registers a job can paint (the phone is drawn from messages, on the main thread). */
export type JobRegister = 'tape' | 'stencil' | 'card' | 'slip' | 'plate' | 'sign';

export interface PaintJob {
  register: JobRegister;
  plan: Plan;
  /** The generator's state after the plan (rng.ts `state()`). */
  rng: number;
  colour?: TapeColour;
  paint?: Token;
  /** Normal map x/y scale (atlas.ts `normalScaleFor`). */
  ns?: [number, number];
}

export function paintJob(j: PaintJob): Painted {
  const r = rng(j.rng);
  const ns = j.ns ?? [1, 1];
  switch (j.register) {
    case 'tape':
      return paintTape(j.plan, j.colour ?? 'black', r, ns);
    case 'plate':
      return paintPlate(j.plan, r, ns);
    case 'sign':
      return paintSign(j.plan, r, ns);
    case 'stencil':
      return paintStencil(j.plan, j.paint ?? 'ink', r);
    case 'card':
    case 'slip':
      return paintPaper(j.plan, r);
  }
}

/** Every buffer a painted label holds (to transfer it, not copy it, between threads). */
export function buffersOf(p: Painted): ArrayBuffer[] {
  return [p.color, p.normal, p.rough].filter((b): b is Uint8Array => !!b).map((b) => b.buffer as ArrayBuffer);
}
