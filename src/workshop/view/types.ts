/**
 * The view's contracts (REWRITE.md § E2): turning simulation state into a
 * picture. A view reads the world and never changes it. Animation is the
 * showing of a change, never the change (§ E5 rule 1): a view may run any
 * transient motion it likes, on the simulation clock, in response to state
 * and events, but what *happened* is decided in `sim`.
 */
import type { Object3D, Scene, Texture } from 'three';
import type { Id, SimEvent, Vec3, WorldView } from '../sim/types.ts';
import type { MaterialClass, Piece } from './kit/types.ts';

export type Tier = 'high' | 'low';

/** The shared materials: one per class (§ E3), plus textured variants for labels. */
export interface Materials {
  /** The shared material of a class. */
  of(cls: MaterialClass): import('three').Material;
  /** A variant of a class carrying a texture made by view/labels (label tape, card, stencil, plate). Cached by key. */
  textured(cls: MaterialClass, key: string): import('three').Material;
  /** Advance anything time-driven (the belt's scroll, bulb flicker). `time` is simulation seconds. */
  update(time: number): void;
  dispose(): void;
}

/** Text drawn to textures from src/content at start-up (§ E3, § A "Text in the world"). */
export interface Labels {
  /** Returns the texture key for a label, creating the texture on first use. */
  tape(text: string, colour?: 'black' | 'red' | 'blue'): string;
  stencil(text: string): string;
  card(text: string): string;
  plate(text: string): string;
  sign(text: string): string;
  /** Size in world units a label of this key wants to be (so capitals meet the 12 px rule). */
  size(key: string): { w: number; h: number };
  texture(key: string): Texture;
  normalMap(key: string): Texture | null;
}

/** What every station view is built with. */
export interface ViewContext {
  readonly scene: Scene;
  readonly materials: Materials;
  readonly labels: Labels;
  readonly tier: Tier;
  readonly reducedMotion: boolean;
  /** Turn a kit Piece into Three.js objects (the only way meshes are made). */
  realize(piece: Piece): Object3D;
  /** Make an object answer to the pointer as this interactable or part. */
  pickable(id: Id, object: Object3D): void;
}

/** One frame's worth of what a view may read. */
export interface Frame {
  readonly world: WorldView;
  /** Events since the last frame, in order. */
  readonly events: readonly SimEvent[];
  /** Simulation seconds, interpolated for this render (use for all animation). */
  readonly time: number;
  /** Seconds since the last render (clamped). */
  readonly dt: number;
  /** 0..1 between the previous simulation step and the current one, for interpolating motion. */
  readonly alpha: number;
  /** Where the pointer is in the world (on the bench plane or on whatever it is over), or null. */
  readonly pointer: Vec3 | null;
  /** What the pointer is over, and what is being carried. */
  readonly hovered: Id | null;
  readonly held: Id | null;
}

/** One view per station (and one per character). */
export interface StationView {
  readonly root: Object3D;
  update(frame: Frame): void;
  dispose(): void;
}

export type StationViewFactory = (ctx: ViewContext) => StationView;
