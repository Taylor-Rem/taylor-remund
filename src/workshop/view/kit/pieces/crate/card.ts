/**
 * P4 S5: the card that stands in an open project crate (REWRITE.md § C "a crate opens to a standing card: the name,
 * one line, the tools"; § A "Text in the world": paper cards are the crew's register, and this one is typed). A stiff
 * paper card, a little bowed and a hair crooked, standing in a slotted wooden foot at the back of the crate's mouth;
 * on its face the project's published title, its one line and its tools (typed into a label region, `paintProjectCard`);
 * at its foot, right, a small brass plate engraved with the way to the full entry (`plate`: a plate label's key).
 * In front of the card, at the mouth's front, a small wooden tray the crate's thing sits on when it has one.
 *
 * Built in the crate's mouth: the origin is the middle of the mouth at the height of the crate's rim (the walls' top),
 * +Z toward the crate's front. The card stands at the back of the mouth on a batten laid across the walls; the tray at
 * the front, `trayY` over the rim. Nodes: `card` (the card, its plate and its batten: the parts view raises it out of
 * the mouth as the lid opens), `tray` (hidden when the crate holds nothing). Socket: `plate` (the plate's face).
 *
 * Every colour is a palette token; browser-only painting is `paintProjectCard`.
 */
import type { KitOptions, Piece } from '../../types.ts';
import type { LabelRegion, Labels } from '../../../types.ts';
import { chain, noShadow, part, piece, texturedPart, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { rng } from '../../rng.ts';
import { bevelBox, sheet } from '../../cheap.ts';
import { hex, type Token } from '../../../palette.ts';
import { font } from '../../../labels/fonts.ts';
import { rng as labelRng } from '../../../labels/rng.ts';
import { crateMouth, type CrateSize } from './index.ts';
import { Matrix4 } from 'three';

/** Texels per world unit of a card's face: its smallest type stays sharp with the camera close. */
export const CARD_TPU = 900;
/** The card's face (world units) for a crate of this size: as wide as the mouth allows, an index card's proportion. */
export function projectCardSize(size: CrateSize): { w: number; h: number } {
  const m = crateMouth(size);
  const w = Math.min(m.w * 0.86, 0.56);
  return { w, h: w * 0.64 };
}

/** The card's region (one per project crate, by name), on the cards' page. */
export function projectCardRegion(labels: Labels, name: string, size: CrateSize): LabelRegion {
  return labels.region(`crate-card|${name}`, projectCardSize(size), { texelsPerUnit: CARD_TPU, alpha: 'opaque' });
}

export interface ProjectCardOptions extends KitOptions {
  size?: CrateSize;
  /** The card face's texture: its region's key. Without it, blank paper (reviews, tests). */
  face?: string;
  /** The brass plate's engraving: a plate label's key and its size. Without it, blank brass. */
  plate?: { key: string; w: number; h: number };
  /** How far over the rim the tray's floor is (its thing sits on it), world units. */
  trayY?: number;
}

const DEG = Math.PI / 180;

export function projectCard(o: ProjectCardOptions = {}): Piece {
  const size = o.size ?? 'M';
  const seed = o.seed ?? 1;
  const detail = o.detail ?? 'high';
  const R = rng(seed * 4241 + size.charCodeAt(0));
  const b = piece('project-card', { detail, seed });
  const m = crateMouth(size);
  const { w, h } = projectCardSize(size);
  const t = 0.004;

  // the card: a stiff sheet a little bowed, leaning back a hair, crooked a hair; its foot a slotted batten across the mouth
  const lean = 7 + R.spread(1.5);
  const back = -m.d / 2 + 0.035;
  const at = chain(T(R.spread(0.008), 0.026, back), new Matrix4().makeRotationY(R.spread(2.2) * DEG), new Matrix4().makeRotationX(-lean * DEG));
  const card = b.node('card', at);
  const bow = (u: number): number => 0.006 * Math.sin(Math.PI * u);
  // (in the card's own frame: its foot's middle at the origin, its face toward +Z)
  const faceG = transform(sheet({ w, h, t, nx: 6, ny: 2, lift: (u) => bow(u) }), T(0, h / 2, 0));
  const backG = transform(sheet({ w, h, t, nx: 6, ny: 2, lift: (u) => bow(u), back: true }), T(0, h / 2, 0));
  card.add(o.face ? texturedPart('paper', faceG, o.face) : part('paper', faceG, 'paper', { seed, shade: 0.98 }));
  card.add(part('paper', backG, 'paper', { seed: seed + 1, shade: 0.92 }));
  // the brass plate at the card's foot, right: a backing plate and its engraved face
  const pl = o.plate ?? { key: '', w: w * 0.3, h: w * 0.07 };
  const scale = Math.min(1, (w * 0.34) / pl.w);
  const pw = pl.w * scale, ph = pl.h * scale;
  const plateAt = T(w / 2 - pw / 2 - 0.018, ph / 2 + 0.014, t + 0.0025);
  card.add(part('brass', transform(bevelBox({ min: [-pw / 2 - 0.006, -ph / 2 - 0.005, -0.002], max: [pw / 2 + 0.006, ph / 2 + 0.005, 0.0016], c: 0.0015, omit: ['nz'] }), plateAt), 'brass', { seed: seed + 2, shade: 0.75 }));
  const plateFace = transform(sheet({ w: pw, h: ph, t: 0.001, nx: 1, ny: 1 }), chain(plateAt, T(0, 0, 0.0016)));
  card.add(o.plate?.key ? noShadow([texturedPart('brass', plateFace, o.plate.key)]) : [part('brass', plateFace, 'brass', { shade: 0.9 })]);
  b.socket('plate', { at: [w / 2 - pw / 2 - 0.018, 0.026 + ph / 2 + 0.014, back] });

  // the foot: a batten laid across the walls at the mouth's back, with a saw cut the card stands in (it rises with it)
  const fw = m.w + 0.05;
  // (the card's node leans back; its batten is laid level)
  const batten = transform(bevelBox({ min: [-fw / 2, -0.026, -0.024], max: [fw / 2, 0.004, 0.02], c: 0.004, omit: ['ny'], wear: 0.8 }), new Matrix4().makeRotationX(lean * DEG));
  card.add(part('wood', batten, 'wood-light', { seed: seed + 3, jitter: 0.08, shade: 0.9 }));

  // the tray at the mouth's front, where the crate's thing sits: a shallow wooden tray with a lip
  const td = m.d * 0.34, tw = Math.min(m.w * 0.62, 0.3);
  const trayAt = T(0, o.trayY ?? 0.01, m.d * 0.18);
  const tray = b.node('tray', trayAt);
  tray.add(part('wood', transform(bevelBox({ min: [-tw / 2, 0, -td / 2], max: [tw / 2, 0.012, td / 2], c: 0.003, omit: ['ny'] }), T(0, 0, 0)), 'wood', { seed: seed + 4, shade: 1.05 }));
  for (const [x0, x1, z0, z1] of [[-tw / 2, tw / 2, td / 2 - 0.008, td / 2], [-tw / 2, tw / 2, -td / 2, -td / 2 + 0.008], [-tw / 2, -tw / 2 + 0.008, -td / 2, td / 2], [tw / 2 - 0.008, tw / 2, -td / 2, td / 2]] as const) {
    tray.add(part('wood', bevelBox({ min: [x0, 0.01, z0], max: [x1, 0.026, z1], c: 0.002, omit: ['ny'] }), 'wood-light', { seed: seed + 5, shade: 0.95 }));
  }
  return b.build();
}

// ---- the card's face (browser only: canvas 2D) ----------------------------------

const css = (tk: Token, a = 1): string => {
  const n = parseInt(hex(tk).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Words that fit `max` px wide at the context's font, broken at spaces (a word longer than the line gets a line of its own). */
function wrapPx(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Type the card: the project's title, its one line and its tools, on cream index stock with a red rule under the title
 * and faint blue lines below (an index card); the type a little uneven, as a typewriter's is. Nothing is written here:
 * every word comes in (`title`, `line`, `tools`: the résumé's published words).
 */
export function paintProjectCard(region: LabelRegion, words: { title: string; line: string; tools: readonly string[] }, seed = 1): void {
  region.draw((ctx, W, H) => {
    const r = labelRng(`crate-card|${seed}|${words.title}`);
    const j = (m: number): number => (r() * 2 - 1) * m;
    // the stock, and its rules
    ctx.fillStyle = css('paper');
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.2, W * 0.5, H * 0.5, W * 0.75);
    g.addColorStop(0, css('paper', 0));
    g.addColorStop(1, css('wood-light', 0.18));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const side = W * 0.07;
    const room = W - 2 * side;
    // the title: as large as two lines of it allow
    let px = H * 0.15;
    ctx.font = font('type', px);
    let title = wrapPx(ctx, words.title, room);
    while (title.length > 2 && px > H * 0.07) {
      px *= 0.92;
      ctx.font = font('type', px);
      title = wrapPx(ctx, words.title, room);
    }
    ctx.textBaseline = 'alphabetic';
    let y = H * 0.1 + px;
    const ink = (a: number): string => css('ink', a);
    const typed = (text: string, x: number, yy: number, size: number, a = 0.92): void => {
      // letter by letter: a typewriter's baseline wanders, some strikes land a little light
      let cx = x;
      for (const ch of text) {
        ctx.fillStyle = ink(r() < 0.15 ? a * 0.8 : a);
        ctx.fillText(ch, cx + j(size * 0.015), yy + j(size * 0.03));
        cx += ctx.measureText(ch).width;
      }
    };
    for (const l of title) {
      typed(l, side + j(px * 0.05), y, px, 0.95);
      y += px * 1.18;
    }
    // the red rule under it
    ctx.strokeStyle = css('cable-red', 0.55);
    ctx.lineWidth = Math.max(1, H * 0.006);
    ctx.beginPath();
    ctx.moveTo(side * 0.5, y - px * 0.72);
    ctx.lineTo(W - side * 0.5, y - px * 0.72 + j(H * 0.004));
    ctx.stroke();
    // the one line
    const sp = px * 0.62;
    ctx.font = font('type', sp);
    y += sp * 0.35;
    for (const l of wrapPx(ctx, words.line, room)) {
      typed(l, side + j(sp * 0.05), y, sp, 0.88);
      y += sp * 1.3;
    }
    // the tools, joined as the résumé lists them, at the foot (left of the plate)
    const tp = px * 0.5;
    ctx.font = font('type', tp);
    const tools = wrapPx(ctx, words.tools.join(' · '), room * 0.62);
    let ty = H - H * 0.09 - (tools.length - 1) * tp * 1.25;
    // faint blue lines behind them, as an index card has
    ctx.strokeStyle = css('paint-blue', 0.18);
    ctx.lineWidth = Math.max(1, H * 0.003);
    for (let k = 0; k < tools.length; k++) {
      ctx.beginPath();
      ctx.moveTo(side * 0.5, ty + tp * 0.28 + k * tp * 1.25);
      ctx.lineTo(W - side * 0.5, ty + tp * 0.28 + k * tp * 1.25);
      ctx.stroke();
    }
    for (const l of tools) {
      typed(l, side + j(tp * 0.05), ty, tp, 0.85);
      ty += tp * 1.25;
    }
  });
}
