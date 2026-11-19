/**
 * The bench's own cursor (R1, Taylor: "a custom cursor would be cool"; REWRITE.md § B1 "the cursor becomes a
 * hand"): a small work glove in four poses, drawn in the palette's colours.
 *
 *  - `rest`: over the stage with nothing usable under it, relaxed, the index fingertip the hotspot;
 *  - `open`: something to take under it (a part, Patch, the lamp's shade, the plug): open and raised;
 *  - `closed`: holding something (a fist);
 *  - `point`: one finger, over something to press (the Button, a handle, the bell, the phone).
 *
 * They are real CSS cursors: images with a hotspot, a 2x image for sharp screens (`image-set`), and the
 * system's cursor as the fallback. Never an element that follows the pointer: the browser draws them, so
 * the cursor costs no frame and adds no latency (§ E0). Over the stage only: the paper pages, the strip and
 * links keep the system's cursor (they never get these); touch has no cursor; a visitor who asks for more
 * contrast, forced colours or reduced motion keeps the system's cursor (`wantsGlove`).
 *
 * The pictures are SVG built here from palette tokens, rasterised once at start-up on a canvas (1x and 2x
 * PNG), so the same glove is sharp at either density. Two candidates (`GLOVES`) were drawn and judged at real
 * size over the lit bench; `GLOVE` is the one in use.
 */
import { hex, type Token } from '../view/palette.ts';

export type GlovePose = 'rest' | 'open' | 'closed' | 'point';
export const GLOVE_POSES: readonly GlovePose[] = ['rest', 'open', 'closed', 'point'];

/** One candidate's materials: the canvas back, the leather (palm patch, fingertips, cuff), the outline, the snap. */
export interface GloveLook {
  readonly name: string;
  readonly canvas: Token;
  /** Lightened toward `paper` by this share (0..1): a canvas glove is paler than any wood. */
  readonly canvasLift: number;
  readonly leather: Token;
  readonly outline: Token;
  readonly snap: Token;
  /** Leather fingertips and a palm patch (a gardener's glove), or plain. */
  readonly patches: boolean;
}

export const GLOVES: Readonly<Record<'canvas' | 'leather', GloveLook>> = {
  /** A: a canvas work glove, leather cuff and fingertips, brass snap, ink outline. */
  canvas: { name: 'canvas', canvas: 'wood-light', canvasLift: 0.62, leather: 'wood', outline: 'ink', snap: 'brass', patches: true },
  /** B: an all-leather glove, darker seams, a paper-white stitched cuff band, brass snap. */
  leather: { name: 'leather', canvas: 'wood-light', canvasLift: 0.08, leather: 'wood', outline: 'ink', snap: 'brass', patches: false },
};

/** The glove in use (see the R1 hand-in for why). */
export const GLOVE: keyof typeof GLOVES = 'canvas';

/** Size in CSS px (the 2x image is twice this). */
export const GLOVE_PX = 32;

/** A colour token mixed toward another (sRGB, by share), as a hex string. */
function mix(a: Token, b: Token, t: number): string {
  const pa = parseInt(hex(a).slice(1), 16);
  const pb = parseInt(hex(b).slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** The hand's lean (degrees, about the picture's centre): a little to the left, as a hand rests on a mouse. */
const LEAN = -14;

/** A finger: a rounded bar from its root (x, y) up by `h`, `w` wide, turned `a` degrees about its root. */
interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
}

interface Shape {
  /** Fingers drawn behind the palm, in order. */
  fingers: Bar[];
  /** The thumb, drawn over the palm. */
  thumb: Bar;
  /** A fist's curled fingers: a rounded block over the palm's top (closed and point), or null. */
  curl: { x: number; y: number; w: number; h: number } | null;
  /** The hotspot, before the lean. */
  hot: [number, number];
}

const SHAPES: Record<GlovePose, Shape> = {
  rest: {
    // relaxed: the fingers together and a little short of their reach, the thumb along the side
    fingers: [
      { x: 10.5, y: 13, w: 3.7, h: 8.8, a: -1 },
      { x: 14, y: 12.4, w: 3.7, h: 9.2, a: 1 },
      { x: 17.5, y: 12.8, w: 3.6, h: 8.3, a: 3 },
      { x: 20.7, y: 14, w: 3.3, h: 6.2, a: 6 },
    ],
    thumb: { x: 9.6, y: 20.6, w: 3.8, h: 6.6, a: -30 },
    curl: null,
    hot: [10.4, 4.4],
  },
  open: {
    fingers: [
      { x: 10.2, y: 13, w: 3.7, h: 10.4, a: -15 },
      { x: 13.9, y: 12.2, w: 3.7, h: 11.2, a: -4 },
      { x: 17.4, y: 12.6, w: 3.6, h: 10.2, a: 7 },
      { x: 20.6, y: 14, w: 3.3, h: 7.8, a: 20 },
    ],
    thumb: { x: 9.6, y: 19, w: 3.8, h: 8, a: -62 },
    curl: null,
    hot: [15.2, 9],
  },
  closed: {
    fingers: [],
    // the thumb laid across the curled fingers
    thumb: { x: 10.2, y: 17.6, w: 3.6, h: 9.4, a: 80 },
    curl: { x: 9, y: 8.6, w: 14.4, h: 7.6 },
    hot: [16, 14],
  },
  point: {
    fingers: [{ x: 10.6, y: 13.2, w: 3.8, h: 12, a: -3 }],
    thumb: { x: 13.4, y: 18, w: 3.6, h: 8.6, a: 80 },
    curl: { x: 13.6, y: 9.6, w: 9.8, h: 6.6 },
    hot: [10.3, 1.4],
  },
};

const r = (n: number): string => (Math.round(n * 100) / 100).toString();

/** The glove in one pose as an SVG document (32 × 32 user units). */
export function gloveSvg(pose: GlovePose, look: GloveLook = GLOVES[GLOVE]): string {
  const s = SHAPES[pose];
  const canvas = mix(look.canvas, 'paper', look.canvasLift);
  const canvasShade = mix(look.canvas, 'ink', 0.12);
  const leather = hex(look.leather);
  const ink = hex(look.outline);
  const brass = hex(look.snap);
  const brassHi = mix(look.snap, 'paper', 0.55);
  const cuffBand = look.patches ? leather : mix('paper', look.canvas, 0.15);
  const sw = 1.35;
  const stroke = `stroke="${ink}" stroke-width="${sw}" stroke-linejoin="round"`;
  const bar = (b: Bar, fill: string, tip: boolean): string => {
    const x = b.x - b.w / 2;
    const y = b.y - b.h;
    const rr = b.w / 2;
    const t = `transform="rotate(${r(b.a)} ${r(b.x)} ${r(b.y)})"`;
    const body = `<rect x="${r(x)}" y="${r(y)}" width="${r(b.w)}" height="${r(b.h + 1.5)}" rx="${r(rr)}" fill="${fill}" ${stroke} ${t}/>`;
    // a leather fingertip (the gardener's glove), or a seam line (the leather glove)
    const cap = tip
      ? look.patches
        ? `<rect x="${r(x + 0.55)}" y="${r(y + 0.55)}" width="${r(b.w - 1.1)}" height="${r(Math.min(3.2, b.h * 0.34))}" rx="${r(rr - 0.5)}" fill="${leather}" ${t}/>`
        : `<line x1="${r(b.x)}" y1="${r(y + 1.6)}" x2="${r(b.x)}" y2="${r(b.y - 0.6)}" stroke="${canvasShade}" stroke-width="0.6" ${t}/>`
      : '';
    return body + cap;
  };
  const parts: string[] = [];
  for (const f of s.fingers) parts.push(bar(f, canvas, true));
  // the palm and back of the hand
  parts.push(`<rect x="8.4" y="11" width="15.6" height="13.4" rx="4.2" fill="${canvas}" ${stroke}/>`);
  if (look.patches) parts.push(`<path d="M10 14.6 Q16.2 12.6 22.4 14.6" fill="none" stroke="${canvasShade}" stroke-width="0.7"/>`);
  if (s.curl) {
    const c = s.curl;
    parts.push(`<rect x="${r(c.x)}" y="${r(c.y)}" width="${r(c.w)}" height="${r(c.h)}" rx="${r(c.h / 2)}" fill="${canvas}" ${stroke}/>`);
    // the knuckles: the curled fingers' seams
    const n = Math.max(2, Math.round(c.w / 3.6));
    for (let i = 1; i < n; i++) {
      const x = c.x + (c.w * i) / n;
      parts.push(`<line x1="${r(x)}" y1="${r(c.y + 1.2)}" x2="${r(x)}" y2="${r(c.y + c.h - 1.3)}" stroke="${ink}" stroke-width="0.85"/>`);
    }
    if (look.patches) parts.push(`<rect x="${r(c.x + 0.7)}" y="${r(c.y + 0.7)}" width="${r(c.w - 1.4)}" height="2.1" rx="1" fill="${leather}"/>`);
  }
  parts.push(bar(s.thumb, canvas, true));
  // the cuff: a band of leather (or stitched paper-white) with a brass snap
  parts.push(`<rect x="9.4" y="23.2" width="13.6" height="7.4" rx="1.8" fill="${cuffBand}" ${stroke}/>`);
  if (!look.patches) parts.push(`<line x1="10.6" y1="25.1" x2="21.8" y2="25.1" stroke="${leather}" stroke-width="0.6" stroke-dasharray="1.1 0.9"/>`);
  parts.push(`<circle cx="19.6" cy="27" r="1.75" fill="${brass}" stroke="${ink}" stroke-width="0.8"/>`);
  parts.push(`<circle cx="19.2" cy="26.6" r="0.55" fill="${brassHi}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g transform="rotate(${LEAN} 16 16)">${parts.join('')}</g></svg>`;
}

/** The hotspot of a pose in the 32-unit picture (the lean applied), rounded to whole CSS px. */
export function gloveHotspot(pose: GlovePose): [number, number] {
  const [x, y] = SHAPES[pose].hot;
  const a = (LEAN * Math.PI) / 180;
  const dx = x - 16, dy = y - 16;
  const hx = 16 + dx * Math.cos(a) - dy * Math.sin(a);
  const hy = 16 + dx * Math.sin(a) + dy * Math.cos(a);
  return [Math.max(0, Math.min(31, Math.round(hx))), Math.max(0, Math.min(31, Math.round(hy)))];
}

/** Does this visitor get the glove? Not on touch, nor for more contrast, forced colours or reduced motion. */
export function wantsGlove(match: (q: string) => boolean = (q) => typeof matchMedia === 'function' && matchMedia(q).matches): boolean {
  if (!match('(any-hover: hover)') || !match('(pointer: fine)')) return false;
  if (match('(prefers-contrast: more)') || match('(forced-colors: active)') || match('(prefers-reduced-motion: reduce)')) return false;
  return true;
}

/** What `input/dom.ts` calls its cursors, and the system cursor each falls back to. */
export const POSE_OF = { default: 'rest', grab: 'open', grabbing: 'closed', pointer: 'point' } as const satisfies Record<string, GlovePose>;
const FALLBACK: Record<GlovePose, string> = { rest: 'default', open: 'grab', closed: 'grabbing', point: 'pointer' };

async function rasterise(svg: string, scale: number): Promise<string> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = GLOVE_PX * scale;
  const g = c.getContext('2d');
  if (!g) throw new Error('cursor: no 2D canvas');
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/**
 * The CSS `cursor` value of each pose: the 1x and 2x pictures with the hotspot, then the system cursor.
 * Resolves to null where the glove is not wanted or cannot be drawn (the caller keeps the system cursors).
 */
export async function gloveCursors(look: GloveLook = GLOVES[GLOVE]): Promise<Record<GlovePose, string> | null> {
  if (typeof document === 'undefined' || !wantsGlove()) return null;
  try {
    const out = {} as Record<GlovePose, string>;
    for (const pose of GLOVE_POSES) {
      const svg = gloveSvg(pose, look);
      const [a, b] = await Promise.all([rasterise(svg, 1), rasterise(svg, 2)]);
      const [hx, hy] = gloveHotspot(pose);
      out[pose] = `image-set(url("${a}") 1x, url("${b}") 2x) ${hx} ${hy}, url("${a}") ${hx} ${hy}, ${FALLBACK[pose]}`;
    }
    return out;
  } catch {
    return null;
  }
}
