/**
 * The view's contracts (REWRITE.md § E2): turning simulation state into a
 * picture. A view reads the world and never changes it. Animation is the
 * showing of a change, never the change (§ E5 rule 1): a view may run any
 * transient motion it likes, on the simulation clock, in response to state
 * and events, but what *happened* is decided in `sim`.
 */
import type { Object3D, Scene, Texture } from 'three';
import type { Id, SimEvent, Vec3, WorldView } from '../sim/types.ts';
import type { MaterialClass, MaterialVariant, Piece } from './kit/types.ts';
import type { Stage } from './stage/index.ts';
import type { Token } from './palette.ts';

export type Tier = 'high' | 'low';

/** The shared materials: one per class (§ E3), plus textured variants for labels. */
export interface Materials {
  /** The shared material of a class. */
  of(cls: MaterialClass, variant?: MaterialVariant): import('three').Material;
  /** A variant of a class carrying a texture made by view/labels (label tape, card, stencil, plate). Cached by key. */
  textured(cls: MaterialClass, key: string): import('three').Material;
  /** Advance anything time-driven (the belt's scroll, bulb flicker). `time` is simulation seconds. */
  update(time: number): void;
  dispose(): void;
  /** (P4 D2b) The paint scheme the enamel wears, and the wipe to another (materials/scheme.ts). Absent on stand-ins. */
  readonly paint?: import('./materials/scheme.ts').SchemeState;
  /** (P4 D2b) What is under `root` keeps its own colours whatever the scheme (the crew, loose parts). Absent on stand-ins. */
  keepColours?(root: import('three').Object3D): number;
}

/**
 * Materials only effects use, kept apart from `Materials` so a stand-in that just
 * feeds `realize` (tests, review pages) does not have to supply them.
 */
export interface EffectMaterials {
  /** The shared soft contact-shadow decal (tinted toward teal-deep; per-instance strength in the instance colour's red). */
  decal(): import('three').Material;
  /** The keyboard focus mark: unlit paper, drawn over everything, never lit or shadowed (view/stations/focus.ts). */
  focusMark(): import('three').Material;
}

/** Text drawn to textures from src/content at start-up (§ E3, § A "Text in the world"). */
export interface Labels {
  /**
   * Each maker returns the texture key for a label, creating the textures on
   * first use. Defaults meet the 12 px rule at the default view; `capHeight`
   * (world units) overrides the height of a capital.
   */
  tape(text: string, colour?: 'black' | 'red' | 'blue', opts?: LabelOptions): string;
  /** Sprayed stencil, in `paint` (default `ink`); transparent background. */
  stencil(text: string, opts?: LabelOptions & { paint?: Token }): string;
  /** A big typed cue card (the crew's voice). */
  card(text: string, opts?: LabelOptions): string;
  /** A narrow torn slip, as Fetch prints. */
  slip(text: string, opts?: LabelOptions): string;
  /** Engraved brass. */
  plate(text: string, opts?: LabelOptions): string;
  /** Hand-painted sign board. */
  sign(text: string, opts?: LabelOptions): string;
  /** A phone screen showing these messages, newest last. */
  phone(messages: readonly LabelPhoneMessage[], opts?: LabelOptions & { screen?: { w: number; h: number } }): string;
  /** Size in world units a label of this key wants to be (so capitals meet the 12 px rule). */
  size(key: string): { w: number; h: number };
  /** World height of this label's capitals. */
  capHeight(key: string): number;
  /** sRGB colour map, full albedo (use with white vertex colour). */
  texture(key: string): Texture;
  normalMap(key: string): Texture | null;
  /** G = roughness, B = metalness (three.js channel convention), or null. */
  roughnessMap(key: string): Texture | null;
  /** True when the colour map's alpha cuts the shape (tape ends, torn slips, stencils): use alphaTest, or blending for stencils. */
  transparent(key: string): boolean;
  /** A region redrawn at run time. The same name returns the same region. */
  region(name: string, size: { w: number; h: number }, opts?: LabelRegionOptions): LabelRegion;
  /** Resolves when every label asked for so far has its pixels. */
  ready(): Promise<void>;
}

export interface LabelOptions {
  /** Height of a capital in world units. */
  capHeight?: number;
  /** Texels per world unit; a label made with it keeps a texture of its own (off the atlas). */
  texelsPerUnit?: number;
}

/** A region of label texture that is redrawn at run time (a sign's words, a counter, a screen). */
export interface LabelRegion {
  /** The texture key: use it as any label key. */
  readonly key: string;
  /** Its size in texels and in world units. */
  readonly px: { w: number; h: number };
  readonly size: { w: number; h: number };
  /** Repaint on a cleared 2D canvas of the region's size; only the region's rows are uploaded. */
  draw(paint: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number) => void): void;
  /** Write rows [top, top + n) from RGBA bytes, rows top-down, `px.w` wide. */
  put(rows: Uint8Array | Uint8ClampedArray, top?: number, n?: number): void;
}

export interface LabelRegionOptions {
  /** Texels per world unit (default 320, the cards'). */
  texelsPerUnit?: number;
  /** How its alpha is used: 'opaque' (default), 'cut' (alphaTest), 'spray' (blended, as a stencil). */
  alpha?: 'opaque' | 'cut' | 'spray';
}

/** One message on the phone screen: the owner's (right) or Patch's (left). */
export interface LabelPhoneMessage {
  from: 'owner' | 'patch';
  text: string;
}

/**
 * The parts of the stage a station view may use: frame, shake or focus the
 * camera (`camera.focusOn`, `camera.shake`), and set or dip the lamp
 * (`lights.setLamp`, `lights.dip`, `lights.setBulb`). Never the renderer.
 */
export type StageHandle = Pick<Stage, 'camera' | 'lights'>;

/** What every station view is built with. */
export interface ViewContext {
  readonly scene: Scene;
  readonly stage: StageHandle;
  readonly materials: Materials & EffectMaterials;
  readonly labels: Labels;
  readonly tier: Tier;
  readonly reducedMotion: boolean;
  /**
   * Turn a kit Piece into Three.js objects (the only way meshes are made). Options: kit/realize.ts
   * (`fixedView` for a static world-space piece, `shadowProxy`, `shadowDetail`, …).
   */
  realize(piece: Piece, o?: import('./kit/realize.ts').RealizeOptions): Object3D;
  /**
   * Make an object answer to the pointer as this interactable or part. Without options the target is
   * the box round the object's meshes; `box` (in the object's own frame) gives a target of its own (a
   * bone has no meshes; a shade is smaller than its lamp), `pad` grows it (world units).
   */
  pickable(id: Id, object: Object3D, opts?: import('./picking.ts').PickableOptions): void;
  /** A pick target's box in world space (padded as it picks), into `out`; null if `id` has none. For marks drawn round targets. */
  targetBox?(id: Id, out: import('three').Box3): import('three').Box3 | null;
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
  /**
   * Keyboard focus on the stage (an interactable, or the phone's pick target), or null. The focus view
   * marks it (view/stations/focus.ts); a station need draw nothing for it.
   */
  readonly focused: Id | null;
  /** While the keys hold something: the destination they have chosen (a mouth or a jack), or null. */
  readonly keyDest: Id | null;
  /**
   * A dial or lever being dragged: its id and where the hand has it, 0..1 over its travel, between
   * detents (the world holds only the detent; the handle may follow the hand and fall into it). Else null.
   */
  readonly working: { readonly id: Id; readonly value: number } | null;
}

/** One view per station (and one per character). */
export interface StationView {
  readonly root: Object3D;
  update(frame: Frame): void;
  dispose(): void;
}

export type StationViewFactory = (ctx: ViewContext) => StationView;
