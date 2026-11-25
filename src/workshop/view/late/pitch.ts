/**
 * (E1) Pitch's views, in his own chunk (astro.config's `late-pitch` group): his kit pieces' catalogue (added to the
 * list the bench's lookups read once he has arrived) and his station view, which draws him and his mast. Nothing
 * the page loads first imports this file; `view/late.ts` fetches it after the bench is usable.
 */
import type { StationViewFactory, Tier } from '../types.ts';
import { catalogue, pitch, pitchMast, type MastOptions, type PitchOptions } from '../kit/pieces/pitch/index.ts';
import { unpackPiece, type PackedPiece } from '../kit/transfer.ts';
import type { Piece } from '../kit/types.ts';
import { createPitchView, PITCH_LOOKS } from '../stations/pitch.ts';

export { catalogue as pieces };

export interface PitchLateOptions {
  /** The crew's drawing scale. */
  readonly scale: number;
  readonly tier: Tier;
  /** Where the scene moors him (`PITCH_AT`): the mast's foot (x, z), his heading moored, the mast's height in the kit's units. */
  readonly mast: { readonly at: readonly [number, number]; readonly heading: number; readonly height: number };
}

/**
 * A breath: each piece is built (and baked: the bake table does not hold his) in an idle time of its own, after a
 * frame has been drawn, never in the middle of the bench's frames.
 */
const breathe = (): Promise<void> =>
  new Promise((r) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric.bind(globalThis)(() => r(), { timeout: 1000 });
    else setTimeout(r, 0);
  });

/** His pieces built in a worker (off the main thread), or null if there is none or it fails. */
async function offThread(body: PitchOptions, mast: MastOptions): Promise<{ body: Piece; mast: Piece } | null> {
  if (typeof Worker === 'undefined') return null;
  let w: Worker | null = null;
  try {
    w = new Worker(new URL('./pitch-worker.ts', import.meta.url), { type: 'module' });
    const answer = await new Promise<{ body?: PackedPiece; mast?: PackedPiece; error?: string }>((res, rej) => {
      w!.onmessage = (e: MessageEvent<{ body?: PackedPiece; mast?: PackedPiece; error?: string }>) => res(e.data);
      w!.onerror = (e) => rej(e);
      w!.postMessage({ body, mast });
    });
    if (!answer.body || !answer.mast) return null;
    return { body: unpackPiece(answer.body), mast: unpackPiece(answer.mast) };
  } catch {
    return null;
  } finally {
    w?.terminate();
  }
}

/**
 * His views, made on the running stage as he joins the world: his pieces built first, off the main thread where there
 * is a worker, else here, each in an idle time of its own.
 */
export async function prepare(o: PitchLateOptions): Promise<StationViewFactory[]> {
  const detail = o.tier === 'low' ? 'low' : 'high';
  const bodyOpts: PitchOptions = { ...PITCH_LOOKS.piece, detail };
  const mastOpts: MastOptions = { height: o.mast.height, seed: PITCH_LOOKS.mastSeed, detail };
  let built = await offThread(bodyOpts, mastOpts);
  if (!built) {
    await breathe();
    const body = pitch(bodyOpts);
    await breathe();
    const mast = pitchMast(mastOpts);
    built = { body, mast };
  }
  await breathe();
  return [createPitchView({ scale: o.scale, seed: PITCH_LOOKS.piece.seed, mast: o.mast, built })];
}
