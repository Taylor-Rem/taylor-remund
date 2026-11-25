/**
 * (E1) Pitch's views, in his own chunk (astro.config's `late-pitch` group): his kit pieces' catalogue (added to the
 * list the bench's lookups read once he has arrived) and his station view, which draws him and his mast. Nothing
 * the page loads first imports this file; `view/late.ts` fetches it after the bench is usable.
 */
import type { StationViewFactory, Tier } from '../types.ts';
import { catalogue, pitch, pitchMast } from '../kit/pieces/pitch/index.ts';
import { createPitchView, PITCH_LOOKS } from '../stations/pitch.ts';

export { catalogue as pieces };

export interface PitchLateOptions {
  /** The crew's drawing scale. */
  readonly scale: number;
  readonly tier: Tier;
  /** Where the scene moors him (`PITCH_AT`): the mast's foot (x, z), his heading moored, the mast's height in the kit's units. */
  readonly mast: { readonly at: readonly [number, number]; readonly heading: number; readonly height: number };
}

/** A task's breath: each piece is built (and baked: the bake table does not hold his) in a task of its own. */
const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** His views, made on the running stage as he joins the world: his pieces built first, one task each. */
export async function prepare(o: PitchLateOptions): Promise<StationViewFactory[]> {
  const detail = o.tier === 'low' ? 'low' : 'high';
  await breathe();
  const body = pitch({ ...PITCH_LOOKS.piece, detail });
  await breathe();
  const mast = pitchMast({ height: o.mast.height, seed: PITCH_LOOKS.mastSeed, detail });
  await breathe();
  return [createPitchView({ scale: o.scale, seed: PITCH_LOOKS.piece.seed, mast: o.mast, built: { body, mast } })];
}
