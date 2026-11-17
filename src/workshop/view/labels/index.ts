/**
 * Text in the world (REWRITE.md § A "Text in the world", art-direction § 7):
 * label tape, crate stencils, typed cards and slips, engraved brass plates,
 * the hand-painted sign and the phone screen, drawn to textures at start-up
 * from src/content. Implements the `Labels` contract of view/types.ts and a
 * little more (roughness maps, slips, the phone, per-label options).
 *
 *   const labels = await createLabels({ anisotropy: renderer.capabilities.getMaxAnisotropy() });
 *   const key = labels.tape(world.tape.doNotTouch, 'black');
 *   labels.size(key)          // world units the quad wants (meets the 12 px rule by default)
 *   labels.texture(key)       // sRGB colour map, full albedo (use with white vertex colour)
 *   labels.normalMap(key)     // tangent-space normal map, or null
 *   labels.roughnessMap(key)  // G = roughness, B = metalness, or null
 *   labels.transparent(key)   // true: the colour map's alpha cuts the shape (use alphaTest)
 *
 * Textures are RGBA8 with mipmaps; rows are uploaded bottom-up, so u runs
 * left to right along the text and v bottom to top on a standard quad.
 */
import { ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import type { Texture } from 'three';
import type { Token } from '../palette.ts';
import type { Labels } from '../types.ts';
import type { Painted } from './draw.ts';
import { ARROW, ARROW_ADVANCE, advance, checkText, paintPaper, paintPhone, paintPlate, paintSign, paintStencil, paintTape } from './draw.ts';
import { loadFonts } from './fonts.ts';
import type { FaceRole } from './fonts.ts';
import type { PhoneMessage, Plan, PlanOptions, Register, TapeColour } from './layout.ts';
import { TAPES, labelKey, planPaper, planPhone, planPlate, planSign, planStencil, planTape, textureBytes } from './layout.ts';
import { halve, toTextureRows } from './raster.ts';
import { rng } from './rng.ts';

export { world } from './content.ts';
export type { PhoneMessage, PlanOptions, Register, TapeColour } from './layout.ts';
export { REGISTERS, capPx, minCapHeight, DEFAULT_VIEW } from './layout.ts';

export interface LabelsOptions {
  /** Max anisotropy to use (pass renderer.capabilities.getMaxAnisotropy()). Default 8. */
  anisotropy?: number;
  /** Where the font files are served. Default `/fonts/`. */
  fontBase?: string;
  /** Changes every label's seeded imperfection at once. Default 'labels'. */
  seed?: string;
}

export interface LabelEntry {
  key: string;
  register: Register;
  text: string;
  size: { w: number; h: number };
  capHeight: number;
  px: { w: number; h: number };
  map: Texture;
  normal: Texture | null;
  rough: Texture | null;
  transparent: boolean;
  bytes: number;
}

export interface WorkshopLabels extends Labels {
  tape(text: string, colour?: TapeColour, opts?: PlanOptions): string;
  stencil(text: string, opts?: PlanOptions & { paint?: Token }): string;
  card(text: string, opts?: PlanOptions): string;
  /** The narrow torn slip Fetch prints. */
  slip(text: string, opts?: PlanOptions): string;
  plate(text: string, opts?: PlanOptions): string;
  sign(text: string, opts?: PlanOptions): string;
  /** A phone screen showing these messages (newest last). */
  phone(messages: readonly PhoneMessage[], opts?: PlanOptions & { screen?: { w: number; h: number } }): string;
  roughnessMap(key: string): Texture | null;
  transparent(key: string): boolean;
  /** World height of this label's capitals. */
  capHeight(key: string): number;
  entry(key: string): LabelEntry;
  /** Every label made so far, and the GPU memory their textures take (RGBA8 + mips). */
  memory(): { labels: number; textures: number; bytes: number };
  entries(): readonly LabelEntry[];
  dispose(): void;
}

function upload(data: Uint8Array, w: number, h: number, colour: boolean, anisotropy: number): DataTexture {
  const t = new DataTexture(toTextureRows(data, w, h), w, h, RGBAFormat, UnsignedByteType);
  t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  t.unpackAlignment = 4;
  t.needsUpdate = true;
  return t;
}

/** Load the fonts (rejects loudly if any is missing), then return the label factory. */
export async function createLabels(opts: LabelsOptions = {}): Promise<WorkshopLabels> {
  await loadFonts(opts.fontBase);
  const anisotropy = opts.anisotropy ?? 8;
  const seed = opts.seed ?? 'labels';
  const made = new Map<string, LabelEntry>();

  const advFor = new Map<FaceRole, ReturnType<typeof advance>>();
  const adv = (role: FaceRole): ReturnType<typeof advance> => {
    let a = advFor.get(role);
    if (!a) {
      const base = advance(role);
      a = role === 'stencil' ? (ch, next) => (ch === ARROW ? ARROW_ADVANCE : base(ch, next === ARROW ? undefined : next)) : base;
      advFor.set(role, a);
    }
    return a;
  };

  const make = (key: string, register: Register, text: string, build: () => { plan: Plan; painted: Painted }): string => {
    if (made.has(key)) return key;
    const { plan, painted } = build();
    const map = upload(painted.color, painted.w, painted.h, true, anisotropy);
    const normal = painted.normal ? upload(painted.normal, painted.w, painted.h, false, anisotropy) : null;
    // Roughness varies slowly and the eye forgives it: half resolution, a quarter of the memory.
    const half = painted.rough ? halve(painted.rough, painted.w, painted.h) : null;
    const rough = half ? upload(half.data, half.w, half.h, false, anisotropy) : null;
    const per = textureBytes(painted.w, painted.h);
    made.set(key, {
      key,
      register,
      text,
      size: { ...plan.world },
      capHeight: plan.capWorld,
      px: { ...plan.px },
      map,
      normal,
      rough,
      transparent: painted.alpha,
      bytes: per * (1 + (normal ? 1 : 0)) + (half ? textureBytes(half.w, half.h) : 0),
    });
    return key;
  };
  const r = (key: string) => rng(`${seed}|${key}`);
  const get = (key: string): LabelEntry => {
    const e = made.get(key);
    if (!e) throw new Error(`labels: no label with key ${JSON.stringify(key)}; make it first`);
    return e;
  };

  const labels: WorkshopLabels = {
    tape(text, colour = TAPES[0], o) {
      const key = labelKey('tape', text, colour, o);
      return make(key, 'tape', text, () => {
        const t = text.toUpperCase();
        checkText('tape', t);
        const rr = r(key);
        const plan = planTape(t, adv('tape'), rr, o);
        return { plan, painted: paintTape(plan, colour, rr) };
      });
    },
    stencil(text, o) {
      const paint = o?.paint ?? 'ink';
      const key = labelKey('stencil', text, paint, o);
      return make(key, 'stencil', text, () => {
        const t = text.toUpperCase();
        checkText('stencil', t.split(ARROW).join(''));
        const rr = r(key);
        const plan = planStencil(t, adv('stencil'), rr, o);
        return { plan, painted: paintStencil(plan, paint, rr) };
      });
    },
    card(text, o) {
      const key = labelKey('card', text, '', o);
      return make(key, 'card', text, () => {
        checkText('type', text);
        const rr = r(key);
        const plan = planPaper('card', text, adv('type'), rr, o);
        return { plan, painted: paintPaper(plan, rr) };
      });
    },
    slip(text, o) {
      const key = labelKey('slip', text, '', o);
      return make(key, 'slip', text, () => {
        checkText('type', text);
        const rr = r(key);
        const plan = planPaper('slip', text, adv('type'), rr, o);
        return { plan, painted: paintPaper(plan, rr) };
      });
    },
    plate(text, o) {
      const key = labelKey('plate', text, '', o);
      return make(key, 'plate', text, () => {
        const t = text.toUpperCase();
        checkText('tape', t);
        const rr = r(key);
        const plan = planPlate(t, adv('tape'), rr, o);
        return { plan, painted: paintPlate(plan, rr) };
      });
    },
    sign(text, o) {
      const key = labelKey('sign', text, '', o);
      return make(key, 'sign', text, () => {
        const t = text.toUpperCase();
        checkText('sign', t);
        const rr = r(key);
        const plan = planSign(t, adv('sign'), rr, o);
        return { plan, painted: paintSign(plan, rr) };
      });
    },
    phone(messages, o) {
      const text = messages.map((m) => `${m.from}:${m.text}`).join('\n');
      const key = labelKey('phone', text, '', o);
      return make(key, 'phone', text, () => {
        const rr = r(key);
        const plan = planPhone(o);
        return { plan, painted: paintPhone(plan, messages, rr) };
      });
    },
    size: (key) => ({ ...get(key).size }),
    texture: (key) => get(key).map,
    normalMap: (key) => get(key).normal,
    roughnessMap: (key) => get(key).rough,
    transparent: (key) => get(key).transparent,
    capHeight: (key) => get(key).capHeight,
    entry: get,
    entries: () => [...made.values()],
    memory() {
      let textures = 0;
      let bytes = 0;
      for (const e of made.values()) {
        textures += 1 + (e.normal ? 1 : 0) + (e.rough ? 1 : 0);
        bytes += e.bytes;
      }
      return { labels: made.size, textures, bytes };
    },
    dispose() {
      for (const e of made.values()) {
        e.map.dispose();
        e.normal?.dispose();
        e.rough?.dispose();
      }
      made.clear();
    },
  };
  return labels;
}
