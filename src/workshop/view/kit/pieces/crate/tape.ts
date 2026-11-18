/**
 * A crate's label tape: the words (the visitor's own, from `Part.label`)
 * embossed on a strip of black label tape, painted into the crate's own
 * label region (`Labels.region`, a sprayed region on the atlas page the
 * stencils use, so the quad merges into their mesh). Browser only: canvas 2D.
 *
 * The strip is cut to its words, as a label maker cuts it: a lead before the
 * first capital and after the last, both ends snipped a little crooked. It
 * starts at the region's left edge; `paintCrateTape` returns how much of the
 * region's width it takes (0..1), which is what a laid length of 1 means.
 *
 * Every colour is a palette token.
 */
import type { LabelRegion, Labels } from '../../../types.ts';
import { hex, type Token } from '../../../palette.ts';
import { context } from '../../../labels/draw.ts';
import { font, SUBSET } from '../../../labels/fonts.ts';
import { rng } from '../../../labels/rng.ts';
import { crateTapeSize, type CrateSize } from './index.ts';

/** Texels per world unit of a crate's tape: capitals stay sharp with the camera close or the crate in the hand. */
export const TAPE_TPU = 1200;
/** Capital height as a share of the strip's height; the lead at each end in capitals; the narrowest squeeze. */
const CAP = 0.54;
const LEAD = 0.5;
const MIN_SQUEEZE = 0.7;

/** The crate's tape region (one per crate, by name), sized for a crate of this size. */
export function crateTapeRegion(labels: Labels, name: string, size: CrateSize): LabelRegion {
  return labels.region(`crate-tape|${name}`, crateTapeSize(size), { texelsPerUnit: TAPE_TPU, alpha: 'spray' });
}

/** What the strip can carry: capitals the tape face has, single spaces. */
export function tapeText(text: string): string {
  const up = [...text.toUpperCase().replace(/\s+/g, ' ')].filter((c) => SUBSET.tape.includes(c)).join('');
  return up.replace(/ +/g, ' ').trim();
}

const css = (t: Token, a = 1, k = 1): string => {
  const n = parseInt(hex(t).slice(1), 16);
  const c = (s: number): string => Math.round(Math.min(255, ((n >> s) & 255) * k)).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;
};

let capRatio = 0;
function tapeCapRatio(): number {
  if (!capRatio) {
    const c = context(8, 8);
    c.font = font('tape', 100);
    capRatio = c.measureText('H').actualBoundingBoxAscent / 100 || 0.7;
  }
  return capRatio;
}

/**
 * Paint `text` on the region as a strip of label tape; '' clears it. Returns the strip's
 * length as a share of the region's width (0 for no words).
 */
export function paintCrateTape(region: LabelRegion, text: string, seed = 1): number {
  const words = tapeText(text);
  let used = 0;
  region.draw((ctx, W, H) => {
    if (!words) return;
    const r = rng(`crate-tape|${seed}|${words}`);
    const j = (m: number): number => (r() * 2 - 1) * m;
    // the words: as tall as the strip allows, squeezed a little before they are made smaller
    let cap = H * CAP;
    ctx.font = font('tape', cap / tapeCapRatio());
    const natural = ctx.measureText(words).width;
    let squeeze = 1;
    const room = W - 2 * LEAD * cap;
    if (natural > room) {
      squeeze = Math.max(MIN_SQUEEZE, room / natural);
      if (natural * squeeze > room) {
        cap *= room / (natural * squeeze);
        ctx.font = font('tape', cap / tapeCapRatio());
      }
    }
    const tw = ctx.measureText(words).width * squeeze;
    const lead = LEAD * cap;
    const L = Math.min(W, tw + 2 * lead);
    used = L / W;
    // the strip, its ends snipped a hair crooked; a hair inside the region top and bottom (the cut edge)
    const y0 = H * 0.04, y1 = H * 0.96;
    const cl = j(H * 0.07), cr = j(H * 0.09);
    const x0 = Math.max(0, H * 0.08), x1 = Math.max(x0 + 1, L - H * 0.08);
    ctx.beginPath();
    ctx.moveTo(x0 + Math.max(0, cl), y0);
    ctx.lineTo(x1 - Math.max(0, cr), y0);
    ctx.lineTo(x1 - Math.max(0, -cr), y1);
    ctx.lineTo(x0 + Math.max(0, -cl), y1);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    // glossy black plastic: a soft sheen along the top, a darker roll at the bottom edge
    g.addColorStop(0, css('ink', 1, 1.5));
    g.addColorStop(0.12, css('ink', 1, 1.15));
    g.addColorStop(0.55, css('ink', 1, 1.0));
    g.addColorStop(0.92, css('ink', 1, 0.8));
    g.addColorStop(1, css('ink', 1, 1.2));
    ctx.fillStyle = g;
    ctx.fill();
    // the embossed capitals: stretched plastic goes white, brightest on the shoulders, with a dark lip below
    ctx.save();
    ctx.clip();
    const base = (y0 + y1) / 2 + cap / 2;
    ctx.textBaseline = 'alphabetic';
    const draw = (dx: number, dy: number, style: string, blur = 0): void => {
      ctx.save();
      ctx.translate(lead + dx, base + dy);
      ctx.scale(squeeze, 1);
      ctx.fillStyle = style;
      if (blur > 0) {
        ctx.shadowColor = style;
        ctx.shadowBlur = blur;
      }
      ctx.fillText(words, 0, 0);
      ctx.restore();
    };
    draw(0, cap * 0.07, css('ink', 0.9, 0.6), cap * 0.06);
    draw(0, 0, css('paper', 0.35), cap * 0.16);
    draw(0, 0, css('paper', 1, 0.86));
    draw(-cap * 0.012, -cap * 0.018, css('paper', 0.55, 1.02));
    ctx.restore();
  });
  return used;
}
