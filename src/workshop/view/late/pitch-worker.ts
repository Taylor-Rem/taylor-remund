/**
 * (E1) Pitch's pieces built off the main thread: his envelope, rig and mast are made (and baked live: the bake table
 * does not hold them) here, and handed back as plain data, their buffers transferred (kit/transfer.ts). Building
 * them on the main thread, after the bench was live, cost one frame of 67 ms (four vsyncs) every time it was measured
 * (shots/e1/arrival-ab2.log): his code runs cold, the first time it runs at all.
 */
import { pitch, pitchMast, type PitchOptions, type MastOptions } from '../kit/pieces/pitch/index.ts';
import { packPiece } from '../kit/transfer.ts';

interface Ask {
  body: PitchOptions;
  mast: MastOptions;
}

const scope = globalThis as unknown as { onmessage: ((e: MessageEvent<Ask>) => void) | null; postMessage(m: unknown, transfer: Transferable[]): void };
scope.onmessage = (e) => {
  try {
    const b = packPiece(pitch(e.data.body));
    const m = packPiece(pitchMast(e.data.mast));
    scope.postMessage({ body: b.packed, mast: m.packed }, [...b.transfer, ...m.transfer]);
  } catch (err) {
    scope.postMessage({ error: String(err) }, []);
  }
};
