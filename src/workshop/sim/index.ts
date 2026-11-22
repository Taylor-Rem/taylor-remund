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
// the read-only surface (WorldView and everything it returns, SceneDesc included)
export type * from './types.ts';
export { createWorld, LOOSE_TUNING } from './world.ts';
export type { World, WorldOptions, StepFault } from './world.ts';
export type { CommitResult } from './context.ts';
export type { Change, HistoryHooks, HistoryPort, Recorded, ActionKind, Entry, Job, TransactionView, UndoOutcome, UndoRequest, Undone } from './history.ts';
export { createHistory, p1History, HISTORY_TUNING } from './history.ts';
export type { Writer } from './store.ts';
export { CRATES_TUNING } from './machines/crates.ts';
export { BUTTON_TUNING } from './machines/button.ts';
export { FETCH_TUNING, fetchReach, fetchStand, canRunLap } from './crew/fetch.ts';
export { lanePath, laneOutline } from './path.ts';
export type { LanePath, Pt } from './path.ts';
export { vignette, AT as VIGNETTE_LAYOUT } from './scenes/vignette.ts';
export { bench, AT as BENCH_LAYOUT, LINE, CREW_SCALE } from './scenes/bench.ts';
export { BELT_TUNING } from './machines/belt.ts';
export { STRIKER_TUNING, NOTE, OCTAVE } from './machines/striker.ts';
export { DOCK_TUNING, MARK_SHIPPED, MARK_RETURN } from './machines/dock.ts';
export { rampAt, rampDoor, rampLength } from './ramp.ts';
export type { RampSpec, RampPoint } from './ramp.ts';
export type { MouthSpec, UnitFactory } from './scene.ts';
export type { PhysicsPort } from './physics/port.ts';
export { createStubPhysics } from './physics/stub.ts';
export { DT, HZ } from './clock.ts';
export { rng } from './rng.ts';
export type { Rng } from './rng.ts';
export { registryProblems } from './registry.ts';
// P3: what a visit remembers (§ E10), the tells (§ B3)
export { parseSaved, savedText, FRESH_SAVED, SAVED_VERSION } from './saved.ts';
export type { WorldSaved, SavedCover } from './saved.ts';
export { TELL_TUNING } from './tells.ts';
export { TELL_SECONDS } from './machine.ts';
// the Patchlamp station (S3): the words Patch understands, and the station's tunings and numbers
export { parse, MAX_TEXT, UNDO_REPLIES, PAINTS, PICTURES, JACKS, REPLY_IDS, jackOf } from './instruct/index.ts';
export type { Colour, Instruction, Jack, LampColour, Parsed, Picture, Refusal, RefusalReason, Reply, ReplyId, ReplyLine, Verb } from './instruct/index.ts';
export { PATCHLAMP } from './scenes/bench.ts';
export { PATCH_TUNING } from './crew/patch.ts';
export { LAMP_TUNING } from './machines/lamp.ts';
export { STOREFRONT_START } from './machines/storefront.ts';
export { PATCHLAMP_BEAT_SECONDS, STOREFRONT_FIELDS, LAMP_FIELDS, WINDOW_PICTURES } from './machines/shared/patchlamp.ts';
// P4 D1: the ledger board (its scene ids, its arithmetic and its show, for the view)
export { LEDGER } from './scenes/bench.ts';
export { TOKENS_FIELD } from './machines/ledger.ts';
export { TIER, TOKENS, CUPS, MONTH, isRubber, placeOf, cupIndex, rubberOf, balanced, tokensAt, starAt, LEDGER_SHOW } from './machines/shared/ledger-board.ts';
export type { Place, Tokens, TokenAt, LedgerScript } from './machines/shared/ledger-board.ts';
// P4 D2b: the paint dial (its scene ids, its field and its schemes, for the view)
export { PAINT } from './scenes/bench.ts';
export { SCHEME_FIELD, PAINT_TUNING } from './machines/paint-dial.ts';

/** Load Rapier (its wasm arrives now, not with the page) and make the physics port. */
export async function createRapierPhysics(): Promise<import('./physics/port.ts').PhysicsPort> {
  const m = await import('./physics/rapier.ts');
  return m.createRapierPhysics();
}
