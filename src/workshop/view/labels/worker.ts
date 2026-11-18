/**
 * A label painter off the main thread (T1). It loads the same four faces
 * (from the same URLs: the HTTP cache has them), then paints jobs (paint.ts)
 * on OffscreenCanvas with the same code the main thread would run, and
 * sends the bytes back (transferred, not copied).
 *
 * Messages in:  { type: 'init', base }   { type: 'job', id, job }
 * Messages out: { type: 'ready' }  { type: 'failed', error }
 *               { type: 'done', id, painted, ms }  { type: 'error', id, error }
 * Any failure is answered, and the main thread paints that job itself.
 */
import { FACES } from './fonts.ts';
import type { PaintJob } from './paint.ts';
import { buffersOf, paintJob } from './paint.ts';

interface WorkerScope {
  fonts?: { add(f: FontFace): void };
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const scope = globalThis as unknown as WorkerScope;

let ready: Promise<void> | null = null;

async function init(base: string): Promise<void> {
  if (!scope.fonts || typeof OffscreenCanvas === 'undefined' || typeof FontFace === 'undefined') {
    throw new Error('labels worker: no FontFaceSet or OffscreenCanvas in this worker');
  }
  const faces = Object.values(FACES).map((f) => new FontFace(f.family, `url(${base}${f.file}) format("woff2")`, { display: 'block' }));
  await Promise.all(faces.map((f) => f.load()));
  for (const f of faces) scope.fonts.add(f);
}

scope.onmessage = (e: MessageEvent): void => {
  const m = e.data as { type: 'init'; base: string } | { type: 'job'; id: number; job: PaintJob };
  if (m.type === 'init') {
    ready = init(m.base);
    ready.then(
      () => scope.postMessage({ type: 'ready' }),
      (err: unknown) => scope.postMessage({ type: 'failed', error: String(err) }),
    );
    return;
  }
  const { id, job } = m;
  (ready ?? Promise.reject(new Error('labels worker: not initialised')))
    .then(() => {
      const t0 = performance.now();
      const painted = paintJob(job, true);
      scope.postMessage({ type: 'done', id, painted, ms: performance.now() - t0 }, buffersOf(painted));
    })
    .catch((err: unknown) => scope.postMessage({ type: 'error', id, error: String(err) }));
};
