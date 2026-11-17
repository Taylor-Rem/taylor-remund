/**
 * Label layout maths: sizes, the 12 px rule, glyph placement with seeded
 * jitter, wrapping. Pure; runs in Node. The drawing code (draw.ts) only
 * paints what these plans say.
 *
 * Units: a plan is computed in *cap units* (1 = the height of a capital),
 * then scaled to world units by the register's cap height and to texels by
 * the register's texel density.
 */
import type { Rng } from './rng.ts';
import { jitter } from './rng.ts';

export type Register = 'tape' | 'stencil' | 'card' | 'slip' | 'plate' | 'sign' | 'phone';
/** The three tapes of the contract (view/types.ts Labels.tape): black, red, blue. */
export const TAPES = ['black', 'red', 'blue'] as const;
export type TapeColour = (typeof TAPES)[number];

/** One message on the phone screen: the owner's (right, blue) or Patch's (left). */
export interface PhoneMessage {
  from: 'owner' | 'patch';
  text: string;
}

// ---- the 12 px rule (REWRITE.md § G "Gate G1", art-direction § 7) ----------

/** The default view as the brief gives it; the worst end of each range. */
export const DEFAULT_VIEW = {
  /** World units across a 1440 px wide screen is 20..22, so 65..72 px per unit. */
  pxPerUnit: 65,
  /** The camera is pitched down 30..36 degrees. */
  pitchDeg: 36,
  /** Capitals must be at least this tall on screen. */
  minCapPx: 12,
} as const;

export type Facing = 'front' | 'up';

/**
 * On-screen height in px of a capital `capWorld` units tall, on a surface
 * facing the visitor (`front`, a vertical face, foreshortened by cos pitch)
 * or facing up (`up`, the top of a crate, foreshortened by sin pitch).
 * Long lens: perspective across one label is ignored.
 */
export function capPx(capWorld: number, facing: Facing = 'front', view: { pxPerUnit: number; pitchDeg: number } = DEFAULT_VIEW): number {
  const p = (view.pitchDeg * Math.PI) / 180;
  return capWorld * view.pxPerUnit * (facing === 'front' ? Math.cos(p) : Math.sin(p));
}

/** Smallest cap height (world units) that meets the rule, times `margin`. */
export function minCapHeight(facing: Facing = 'front', margin = 1.1, view: { pxPerUnit: number; pitchDeg: number; minCapPx: number } = DEFAULT_VIEW): number {
  return (view.minCapPx * margin) / capPx(1, facing, view);
}

// ---- registers -----------------------------------------------------------

export interface RegisterSpec {
  /** Default height of a capital in world units. */
  capHeight: number;
  /** Texels per world unit of the colour map. */
  texelsPerUnit: number;
  /** Is this register bound by the 12 px rule at its default size? */
  ruled: boolean;
}

/**
 * Densities are chosen against the closest zoom (one station filling the
 * screen, about 6x the default 65 px/unit, so ~400 px/unit at DPR 1): the
 * small registers sit near 1 texel per pixel there; the sign, whose capitals
 * are 0.9 units tall, can afford fewer texels per unit.
 */
export const REGISTERS: Record<Register, RegisterSpec> = {
  tape: { capHeight: 0.26, texelsPerUnit: 384, ruled: true },
  plate: { capHeight: 0.26, texelsPerUnit: 384, ruled: true },
  sign: { capHeight: 0.9, texelsPerUnit: 224, ruled: true },
  stencil: { capHeight: 0.2, texelsPerUnit: 320, ruled: false },
  card: { capHeight: 0.1, texelsPerUnit: 480, ruled: false },
  slip: { capHeight: 0.085, texelsPerUnit: 480, ruled: false },
  phone: { capHeight: 0.028, texelsPerUnit: 1400, ruled: false },
};

// ---- glyph placement -----------------------------------------------------

/** Advance of `ch` in cap units when followed by `next` (kerning applied if the measurer knows it). */
export type Advance = (ch: string, next?: string) => number;

export interface Jitter {
  /** Extra space after each glyph, cap units. */
  tracking: number;
  /** Uniform ± amounts, cap units / radians / scale fraction. */
  x: number;
  y: number;
  rot: number;
  scale: number;
}

export const NO_JITTER: Jitter = { tracking: 0, x: 0, y: 0, rot: 0, scale: 0 };

export interface GlyphPlace {
  ch: string;
  /** Left edge of the glyph's advance box, cap units from the line start. */
  x: number;
  /** Baseline offset, cap units (positive is down). */
  y: number;
  rot: number;
  scale: number;
}

export interface LineLayout {
  glyphs: GlyphPlace[];
  /** Advance width of the whole line, cap units (last glyph's tracking excluded). */
  width: number;
}

/** Lay out one line, glyph by glyph, with seeded jitter. Spaces advance but are not placed. */
export function layoutLine(text: string, advance: Advance, j: Jitter, r: Rng): LineLayout {
  const chars = [...text];
  const glyphs: GlyphPlace[] = [];
  let cursor = 0;
  chars.forEach((ch, i) => {
    const scale = 1 + jitter(r, j.scale);
    const dx = jitter(r, j.x);
    const dy = jitter(r, j.y);
    const rot = jitter(r, j.rot);
    if (ch !== ' ') glyphs.push({ ch, x: cursor + dx, y: dy, rot, scale });
    cursor += advance(ch, chars[i + 1]) * scale + (i < chars.length - 1 ? j.tracking : 0);
  });
  return { glyphs, width: cursor };
}

/** Greedy word wrap to at most `maxChars` per line (a longer word gets a line of its own). */
export function wrap(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line === '') line = w;
    else if (line.length + 1 + w.length <= maxChars) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

// ---- plans ---------------------------------------------------------------

export interface Plan {
  register: Register;
  /** World size of the label quad. */
  world: { w: number; h: number };
  /** Texture size in texels. */
  px: { w: number; h: number };
  /** Texels per cap unit (cap height in texels). */
  capTexels: number;
  /** World height of a capital. */
  capWorld: number;
  /** Lines of glyphs, each with its baseline (texels from the top) and left edge (texels). */
  lines: { glyphs: GlyphPlace[]; baseline: number; left: number; width: number }[];
}

export interface PlanOptions {
  /** Override the register's cap height (world units). */
  capHeight?: number;
  /** Override the register's density (texels per world unit). */
  texelsPerUnit?: number;
}

function finish(register: Register, wCap: number, hCap: number, opts: PlanOptions | undefined, lines: Plan['lines']): Plan {
  const spec = REGISTERS[register];
  const capWorld = opts?.capHeight ?? spec.capHeight;
  const density = opts?.texelsPerUnit ?? spec.texelsPerUnit;
  const capTexels = capWorld * density;
  const pxW = Math.max(4, Math.round(wCap * capTexels));
  const pxH = Math.max(4, Math.round(hCap * capTexels));
  return {
    register,
    world: { w: (pxW / capTexels) * capWorld, h: (pxH / capTexels) * capWorld },
    px: { w: pxW, h: pxH },
    capTexels,
    capWorld,
    lines: lines.map((l) => ({ ...l, baseline: l.baseline * capTexels, left: l.left * capTexels, width: l.width * capTexels })),
  };
}

/** Proportions of each register, in cap units. Tuned by eye in the dev page. */
export const PROPORTIONS = {
  /** Embossed letters fill a little over half the tape's height, like a hand label maker. */
  tape: { heightPerCap: 1.78, lead: 0.62, trail: 0.7, tracking: 0.2 },
  plate: { heightPerCap: 2.25, sidePad: 0.85, tracking: 0.16 },
  stencil: { heightPerCap: 1.5, sidePad: 0.38, tracking: 0.12 },
  sign: { heightPerCap: 1.72, sidePad: 0.55, tracking: 0.07, shade: 0.085 },
  card: { maxChars: 15, lineGap: 2.05, top: 2.3, bottom: 1.25, side: 1.4 },
  slip: { maxChars: 10, lineGap: 1.85, top: 1.8, bottom: 1.6, side: 1.05 },
} as const;

export function planTape(text: string, adv: Advance, r: Rng, opts?: PlanOptions): Plan {
  const P = PROPORTIONS.tape;
  // A label maker strikes each letter on its own: no kerning, uneven baseline and spacing.
  const line = layoutLine(text.toUpperCase(), (c) => adv(c), { tracking: P.tracking, x: 0.035, y: 0.045, rot: 0.022, scale: 0.0 }, r);
  const lead = P.lead + jitter(r, 0.08);
  const trail = P.trail + jitter(r, 0.1);
  const w = lead + line.width + trail;
  const baseline = (P.heightPerCap + 1) / 2 + jitter(r, 0.03);
  return finish('tape', w, P.heightPerCap, opts, [{ glyphs: line.glyphs, baseline, left: lead, width: line.width }]);
}

export function planPlate(text: string, adv: Advance, r: Rng, opts?: PlanOptions): Plan {
  const P = PROPORTIONS.plate;
  // Engraved from a template: tidy, kerned, barely any jitter.
  const line = layoutLine(text.toUpperCase(), adv, { tracking: P.tracking, x: 0.01, y: 0.008, rot: 0.003, scale: 0 }, r);
  const w = P.sidePad * 2 + line.width;
  return finish('plate', w, P.heightPerCap, opts, [{ glyphs: line.glyphs, baseline: (P.heightPerCap + 1) / 2, left: P.sidePad, width: line.width }]);
}

export function planStencil(text: string, adv: Advance, r: Rng, opts?: PlanOptions): Plan {
  const P = PROPORTIONS.stencil;
  const line = layoutLine(text.toUpperCase(), adv, { tracking: P.tracking, x: 0.02, y: 0.025, rot: 0.012, scale: 0.015 }, r);
  const w = P.sidePad * 2 + line.width;
  return finish('stencil', w, P.heightPerCap, opts, [{ glyphs: line.glyphs, baseline: (P.heightPerCap + 1) / 2, left: P.sidePad, width: line.width }]);
}

export function planSign(text: string, adv: Advance, r: Rng, opts?: PlanOptions): Plan {
  const P = PROPORTIONS.sign;
  // A steady hand: kerned by eye, each capital a touch different.
  const line = layoutLine(text.toUpperCase(), adv, { tracking: P.tracking, x: 0.012, y: 0.014, rot: 0.012, scale: 0.012 }, r);
  const w = P.sidePad * 2 + line.width + P.shade;
  return finish('sign', w, P.heightPerCap, opts, [{ glyphs: line.glyphs, baseline: (P.heightPerCap + 1) / 2 - P.shade / 2, left: P.sidePad, width: line.width }]);
}

/** Typed paper: a card (index card, ruled) or a slip (narrow, perforated). Monospaced, so wrap by characters. */
export function planPaper(register: 'card' | 'slip', text: string, adv: Advance, r: Rng, opts?: PlanOptions): Plan {
  const P = PROPORTIONS[register];
  const rows = wrap(text, P.maxChars);
  const a = adv('M');
  const widest = Math.max(...rows.map((s) => [...s].length));
  const textW = Math.max(widest, register === 'card' ? 11 : 7) * a;
  const w = P.side * 2 + textW;
  let h = P.top + (rows.length - 1) * P.lineGap + 1 + P.bottom;
  if (register === 'card') h = Math.max(h, w * 0.6); // index-card proportions, 5 x 3
  const lines = rows.map((s, i) => {
    // A typewriter's baseline wanders per letter; its carriage is set by hand per line.
    const l = layoutLine(s, () => a, { tracking: 0, x: 0.03, y: 0.05, rot: 0.012, scale: 0 }, r);
    return { glyphs: l.glyphs, baseline: P.top + 1 + i * P.lineGap + jitter(r, 0.05), left: P.side + jitter(r, 0.1), width: l.width };
  });
  return finish(register, w, h, opts, lines);
}

/** Phone screen: fixed world size, laid out by draw.ts. */
export const PHONE_SCREEN = { w: 0.34, h: 0.6 } as const;

export function planPhone(opts?: PlanOptions & { screen?: { w: number; h: number } }): Plan {
  const s = opts?.screen ?? PHONE_SCREEN;
  const cap = opts?.capHeight ?? REGISTERS.phone.capHeight;
  return finish('phone', s.w / cap, s.h / cap, opts, []);
}

// ---- keys and memory -------------------------------------------------------

export function labelKey(register: Register, text: string, variant = '', opts?: PlanOptions): string {
  const o = opts?.capHeight !== undefined || opts?.texelsPerUnit !== undefined ? `@${opts.capHeight ?? ''}/${opts.texelsPerUnit ?? ''}` : '';
  return `${register}${variant ? ':' + variant : ''}${o}|${text}`;
}

/** GPU bytes of an RGBA8 texture with a full mip chain. */
export function textureBytes(w: number, h: number, mipmaps = true): number {
  let total = 0;
  let a = w;
  let b = h;
  for (;;) {
    total += a * b * 4;
    if (!mipmaps || (a === 1 && b === 1)) break;
    a = Math.max(1, a >> 1);
    b = Math.max(1, b >> 1);
  }
  return total;
}
