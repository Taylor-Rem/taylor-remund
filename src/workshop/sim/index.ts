/**
 * The simulation's public entry: besides `types.ts`, the only file in `sim`
 * that `view`, `input`, `audio`, `ui` and `shell` may import from.
 *
 * Typical use (the shell):
 *
 *   const physics = await createRapierPhysics();       // after first paint (§ E6)
 *   const world = createWorld({ seed: 1, physics });     // the vignette by default
 *   // every frame: world.dispatch(...intents); for each due fixed step: world.advance();
 *   // then hand world (a WorldView) and world.drainEvents() to view and audio.
 */
export type * from './types.ts';
export { createWorld, LOOSE_TUNING } from './world.ts';
export type { World, WorldOptions } from './world.ts';
export type { BodyMode, Holding, CommitResult } from './context.ts';
export type { Change, HistoryHooks, Recorded, ActionKind } from './history.ts';
export { p1History } from './history.ts';
export type { Writer } from './store.ts';
export type { ButtonView, RungPhase } from './machines/button.ts';
export { BUTTON_TUNING } from './machines/button.ts';
export type { CordView } from './machines/cord.ts';
export type { FetchState } from './crew/fetch.ts';
export { FETCH_TUNING } from './crew/fetch.ts';
export type { SceneDesc } from './scene.ts';
export { vignette, AT as VIGNETTE_LAYOUT } from './scenes/vignette.ts';
export type { PhysicsPort } from './physics/port.ts';
export { createStubPhysics } from './physics/stub.ts';
export { DT, HZ } from './clock.ts';
export { rng } from './rng.ts';
export type { Rng } from './rng.ts';
export { registryProblems } from './registry.ts';

/** Load Rapier (its wasm arrives now, not with the page) and make the physics port. */
export async function createRapierPhysics(): Promise<import('./physics/port.ts').PhysicsPort> {
  const m = await import('./physics/rapier.ts');
  return m.createRapierPhysics();
}
