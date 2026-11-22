/**
 * THE PAINT SCHEME (D2; DEMO-CONCEPTS concept 2, "one dial, and every machine changes its paint").
 *
 * Every machine on the bench is built from one kit and its enamel takes its colour from one table: a part's
 * vertex colour is a palette token times a scalar shade (kit/surface.ts `tint`), so its HUE says which token it
 * was painted with. A scheme says, for each of a few enamel tokens (the slots), what that token is now. The steel
 * class's shader (classes.ts) recognises a slot by the hue of its vertex colour and multiplies the colour, channel
 * by channel, by `scheme colour / home colour`: the shade, the wear, the chips, the grime and the light all stay as
 * they were, only the paint under them changes.
 *
 * What it costs (measured: shots/d2/): no geometry is touched, no table is re-baked, no program is added. The
 * slots are uniforms of the one steel program; a scheme change writes ~16 numbers. At home (scheme A, no wipe
 * running) the whole block is skipped by one uniform branch, so the picture is the approved one pixel for pixel.
 *
 * THE WIPE. A change runs out from an origin (the dial) as a sphere growing across the room, its rim a little
 * ragged: inside it the new scheme, outside the old. Reduced motion cuts.
 *
 * WHAT KEEPS ITS OWN COLOURS. The crew ("the crew's own colours do not change") and every loose part (a part's
 * colour is its own durable field: a tool the platen painted `teal-light` is teal-light whatever the room is):
 * `keepColours(root)` gives every workshop material under `root` a twin that shares the program and the class's
 * uniforms but never takes the scheme. Call it once on each such root after it is realised.
 */
import { Color, Vector3 } from 'three';
import { linear, linearScheme, schemeColours, type SchemeColour, type Token } from '../palette.ts';

/** The enamel tokens a scheme repaints, in slot order. Their hues must be told apart (see S_MATCH). */
export const SCHEME_SLOTS = ['teal-panel', 'teal-light', 'teal-deep', 'tape-yellow', 'paper'] as const satisfies readonly Token[];
export type SchemeSlot = (typeof SCHEME_SLOTS)[number];

/** A scheme: what each slot is painted. A slot left out keeps its home colour. */
export type Scheme = Partial<Record<SchemeSlot, Token | SchemeColour>>;

/**
 * The schemes, by working letter (the visitor never reads a letter; any name is the owner's). A is the approved
 * look and the home position: it repaints nothing.
 */
export const SCHEMES = {
  A: {},
  B: { 'teal-panel': 'scheme-b-enamel', 'teal-light': 'scheme-b-trim', 'teal-deep': 'scheme-b-deep', paper: 'scheme-b-cream' },
  C: { 'teal-panel': 'scheme-c-enamel', 'teal-light': 'scheme-c-trim', 'teal-deep': 'scheme-c-deep', 'tape-yellow': 'scheme-c-accent', paper: 'scheme-c-cream' },
  D: { 'teal-panel': 'scheme-d-enamel', 'teal-light': 'scheme-d-trim', 'teal-deep': 'scheme-d-deep', 'tape-yellow': 'scheme-d-accent' },
} as const satisfies Record<string, Scheme>;
export type SchemeId = keyof typeof SCHEMES;
export const SCHEME_IDS = Object.keys(SCHEMES) as SchemeId[];
export const HOME_SCHEME: SchemeId = 'A';

/** Tune here. */
export const SCHEME_LOOK = {
  /** How fast the wipe's rim travels (units per simulation second): the room is about 20 across. */
  speed: 9,
  /** How far past the origin the rim must run before the change is done (units): the far corners of the room. */
  reach: 16,
  /** The rim's unevenness (units, ±) and its softness (units: a hair, not a fade). */
  rag: 0.12,
  soft: 0.012,
  /** A thin band of fresh paint just inside the rim, this much lighter, this wide (units). */
  wet: 0.12,
  wetWidth: 0.05,
};

/** How close (squared distance of hue vectors, each normalised to max channel 1) a colour must be to a slot's. */
export const S_MATCH = 1e-4;

/** A linear colour's hue at max channel 1. */
export function hueOf(c: readonly [number, number, number]): [number, number, number] {
  const m = Math.max(c[0], c[1], c[2], 1e-5);
  return [c[0] / m, c[1] / m, c[2] / m];
}

/** The linear colour a scheme gives a slot. */
export function slotColour(id: SchemeId, slot: SchemeSlot): [number, number, number] {
  const to = (SCHEMES[id] as Scheme)[slot];
  if (!to) return linear(slot);
  return to in schemeColours ? linearScheme(to as SchemeColour) : linear(to as Token);
}

/** Per channel: what a slot's vertex colour is multiplied by under scheme `id` (1, 1, 1 at home). */
export function slotMultiplier(id: SchemeId, slot: SchemeSlot): [number, number, number] {
  const h = linear(slot);
  const s = slotColour(id, slot);
  return [s[0] / h[0], s[1] / h[1], s[2] / h[2]];
}

/** Which slot a vertex colour was painted with, or -1 (what the shader decides, for tests and the census). */
export function slotOf(c: readonly [number, number, number]): number {
  const h = hueOf(c);
  for (let i = 0; i < SCHEME_SLOTS.length; i++) {
    const t = hueOf(linear(SCHEME_SLOTS[i]!));
    const d = (h[0] - t[0]) ** 2 + (h[1] - t[1]) ** 2 + (h[2] - t[2]) ** 2;
    if (d < S_MATCH) return i;
  }
  return -1;
}

/** The scheme's uniforms, shared by every material that takes it (`s_on` is per material: see `keepColours`). */
export type SchemeUniforms = Record<string, { value: number | Color | Vector3 }>;

export function schemeUniforms(): SchemeUniforms {
  const u: SchemeUniforms = {
    s_active: { value: 0 },
    s_origin: { value: new Vector3() },
    s_radius: { value: 0 },
    s_rag: { value: SCHEME_LOOK.rag },
    s_soft: { value: SCHEME_LOOK.soft },
    s_wet: { value: 0 },
    s_wetWidth: { value: SCHEME_LOOK.wetWidth },
  };
  SCHEME_SLOTS.forEach((slot, i) => {
    u[`s_hue${i}`] = { value: new Color().fromArray(hueOf(linear(slot))) };
    u[`s_from${i}`] = { value: new Color().setScalar(1) };
    u[`s_to${i}`] = { value: new Color().setScalar(1) };
  });
  return u;
}

/**
 * The GLSL that repaints `pBase` (steel's class block, before anything reads it). `s_on` is the material's own
 * switch (0 on a `keepColours` twin). Skipped entirely, one uniform branch, when nothing is repainted.
 */
export const SCHEME_GLSL = /* glsl */ `
if (s_active * s_on > 0.5) {
  vec3 sHue = pBase / max(max(pBase.r, pBase.g), max(pBase.b, 1e-5));
  vec3 sFrom = vec3(1.0);
  vec3 sTo = vec3(1.0);
${SCHEME_SLOTS.map((_, i) => `  { vec3 e = sHue - s_hue${i}; if (dot(e, e) < ${S_MATCH.toExponential()}) { sFrom = s_from${i}; sTo = s_to${i}; } }`).join('\n')}
  // the fragment in world space (three's fragment prefix has the camera's position and view matrix)
  vec3 sW = cameraPosition + (-vViewPosition) * mat3(viewMatrix);
  float sRag = s_rag * (0.5 * sin(sW.x * 7.1 + sW.z * 3.3) + 0.3 * sin(sW.y * 11.7 + sW.x * 5.1) + 0.2 * sin((sW.z - sW.y) * 19.3 + sW.x * 2.3));
  float sD = length(sW - s_origin) + sRag - s_radius;
  float sIn = 1.0 - smoothstep(-s_soft, s_soft, sD);
  vec3 sM = mix(sFrom, sTo, sIn);
  // fresh paint just inside the rim
  sM *= 1.0 + s_wet * sIn * exp(-(sD * sD) / max(s_wetWidth * s_wetWidth, 1e-6)) * step(0.001, dot(abs(sTo - sFrom), vec3(1.0)));
  pBase *= sM;
}
`;

/** The state of the scheme over time: which is showing, which is arriving, how far the wipe has run. */
export class SchemeState {
  /** The scheme the room shows outside the wipe, and the one arriving inside it. */
  from: SchemeId = HOME_SCHEME;
  to: SchemeId = HOME_SCHEME;
  /** Simulation time the wipe started; NaN: no wipe (the room is all `to`). */
  started = Number.NaN;
  readonly origin = new Vector3();
  #reduced = false;

  readonly u: SchemeUniforms;

  constructor(u: SchemeUniforms) {
    this.u = u;
    this.#write(Infinity);
  }

  get current(): SchemeId {
    return this.to;
  }

  /** Change to `id`: a wipe from `origin` beginning at `time`, or a cut under reduced motion (or with no time). */
  set(id: SchemeId, o: { time?: number; origin?: readonly [number, number, number]; reduced?: boolean } = {}): void {
    if (!(id in SCHEMES)) throw new Error(`scheme: unknown scheme ${String(id)}`);
    // a wipe running is finished where it stands: what has arrived is the room now
    this.from = this.to;
    this.to = id;
    this.#reduced = o.reduced === true;
    if (o.origin) this.origin.set(o.origin[0], o.origin[1], o.origin[2]);
    this.started = o.time === undefined || this.#reduced || this.from === this.to ? Number.NaN : o.time;
    this.#write(Number.isNaN(this.started) ? Infinity : 0);
  }

  /** Each frame: run the wipe on (simulation seconds). True while it runs. */
  update(time: number): boolean {
    if (Number.isNaN(this.started)) return false;
    const r = Math.max(0, time - this.started) * SCHEME_LOOK.speed;
    if (r >= SCHEME_LOOK.reach) {
      this.started = Number.NaN;
      this.from = this.to;
      this.#write(Infinity);
      return false;
    }
    this.#write(r);
    return true;
  }

  #write(radius: number): void {
    const u = this.u;
    const done = !Number.isFinite(radius);
    const from = done ? this.to : this.from;
    SCHEME_SLOTS.forEach((slot, i) => {
      (u[`s_from${i}`]!.value as Color).fromArray(slotMultiplier(from, slot));
      (u[`s_to${i}`]!.value as Color).fromArray(slotMultiplier(this.to, slot));
    });
    (u['s_origin']!.value as Vector3).copy(this.origin);
    u['s_radius']!.value = done ? 1e6 : radius;
    u['s_wet']!.value = done ? 0 : SCHEME_LOOK.wet;
    u['s_rag']!.value = SCHEME_LOOK.rag;
    u['s_soft']!.value = SCHEME_LOOK.soft;
    u['s_wetWidth']!.value = SCHEME_LOOK.wetWidth;
    // home and still: the block is skipped, the approved picture exactly
    u['s_active']!.value = done && this.to === HOME_SCHEME ? 0 : 1;
  }
}
