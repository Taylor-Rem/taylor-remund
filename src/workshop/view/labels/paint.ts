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
import { halve } from './raster.ts';
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
}

/** A painted label as it goes on the atlas: the roughness map already halved (the painter's side does it). */
export interface PaintedJob extends Omit<Painted, 'rough'> {
  rough: null;
  /** Roughness/metalness at half resolution (raster.ts halve), or null. */
  roughHalf: { data: Uint8Array; w: number; h: number } | null;
}

function painted(j: PaintJob): Painted {
  const r = rng(j.rng);
  switch (j.register) {
    case 'tape':
      return paintTape(j.plan, j.colour ?? 'black', r);
    case 'plate':
      return paintPlate(j.plan, r);
    case 'sign':
      return paintSign(j.plan, r);
    case 'stencil':
      return paintStencil(j.plan, j.paint ?? 'ink', r);
    case 'card':
    case 'slip':
      return paintPaper(j.plan, r);
  }
}

/** Paint a job: the label's own picture, or with `half`, ready for the atlas (roughness halved here). */
export function paintJob(j: PaintJob): Painted;
export function paintJob(j: PaintJob, half: true): PaintedJob;
export function paintJob(j: PaintJob, half = false): Painted | PaintedJob {
  const p = painted(j);
  if (!half) return p;
  // Roughness varies slowly and the eye forgives it: half resolution, a quarter of the memory.
  return { ...p, rough: null, roughHalf: p.rough ? halve(p.rough, p.w, p.h) : null };
}

/** Every buffer a painted label holds (to transfer it, not copy it, between threads). */
export function buffersOf(p: PaintedJob): ArrayBuffer[] {
  return [p.color, p.normal, p.roughHalf?.data].filter((b): b is Uint8Array => !!b).map((b) => b.buffer as ArrayBuffer);
}
