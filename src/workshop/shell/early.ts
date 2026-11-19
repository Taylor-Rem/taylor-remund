/**
 * What a stage page starts at the first moment, before its main script and
 * its big chunks (three, the pieces, the station views) have even arrived
 * (B1 round 2; REWRITE.md § E6 "the stage script and, in parallel, the
 * physics file"): the physics engine (its script, then its 1.2 MB wasm,
 * streamed and compiled off the main thread) and the label painters'
 * script, fetched once. The fonts, the wasm and the bake table are asked
 * for by preload links in the page's head (StageHead.astro) and need no
 * script; the fonts' loader rides in a big chunk, so it is not imported here.
 *
 * Load it from a tiny script of its own, placed before the page's main
 * script, and hand `physics()` to the boot:
 *
 *   <script>import { startEarly } from '../workshop/shell/early.ts'; startEarly();</script>
 *   …later: bootWorkshop(canvas, { physics: earlyPhysics, … })
 *
 * Its imports are kept small on purpose (no three, no view code): this
 * script's chunk must arrive in one round trip.
 */
import { createRapierPhysics } from '../sim/physics/rapier.ts';
import type { PhysicsPort } from '../sim/physics/port.ts';

interface Early {
  physics: Promise<PhysicsPort>;
  at: number;
}

const KEY = '__early';

/** Start the physics engine, the fonts and the label worker's script now (once per page). */
export function startEarly(): void {
  const g = globalThis as unknown as Record<string, Early | undefined>;
  if (g[KEY]) return;
  const physics = createRapierPhysics();
  physics.catch(() => {});
  // the painters' script: its fetch is already in flight (the page's preload link); the pool, which takes it
  // once for all its workers, rides in a big chunk, so it is imported lazily (a static import made this whole
  // script, and with it the engine, wait for that chunk: 1.6 s on Fast 4G)
  void import('../view/labels/pool.ts').then((m) => m.prefetchLabelWorker()).catch(() => {});
  g[KEY] = { physics, at: typeof performance !== 'undefined' ? performance.now() : 0 };
}

/** The physics started early, or a fresh start if nothing was (the boot's `physics` option). */
export function earlyPhysics(): Promise<PhysicsPort> {
  const g = globalThis as unknown as Record<string, Early | undefined>;
  return g[KEY]?.physics ?? createRapierPhysics();
}
