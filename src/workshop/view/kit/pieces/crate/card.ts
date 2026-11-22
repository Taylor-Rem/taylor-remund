/**
 * P4 S5: the card that stands in an open project crate (REWRITE.md § C "a crate opens to a standing card: the name,
 * one line, the tools"; § A "Text in the world": paper cards are the crew's register, and this one is typed). A stiff
 * paper card, a little bowed and a hair crooked, standing in a slotted wooden foot at the back of the crate's mouth;
 * on its face the project's published title, its one line and its tools (typed into a label region, `paintProjectCard`);
 * under it, standing on its foot, a brass plate engraved with the way to the full entry (`plate`: a plate label's key;
 * round three: the card stands on the plate, a plate large enough to read and to press, `projectPlateSize`).
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
import { crateMouth, crateSpec, type CrateSize } from './index.ts';
import { Matrix4 } from 'three';

/** Texels per world unit of a card's face: its smallest type stays sharp with the camera close. */
export const CARD_TPU = 900;
/** The card's face (world units) for a crate of this size: as wide as the mouth allows, an index card's proportion. */
export function projectCardSize(size: CrateSize): { w: number; h: number } {
  // (round two) as wide as the crate nearly (it stands above the rim, on its batten), so its type can be large
  const W = crateSpec(size).w;
  const w = Math.min(W * 0.92, 0.6);
  return { w, h: w * 0.62 };
}

/** (round three) The brass plate's height as a share of the card's width: a finger's width across at the closest look. */
export const PLATE_SHARE = 0.2;
/** The plate's margin round its engraving (world units) and the gap between it and the card above it. */
const PLATE_RIM = 0.009;
const PLATE_GAP = 0.01;

/**
 * (round three) The brass plate under a card of this size, for an engraving label of this size (as made, at its own cap
 * height `labelCap`): the plate (w, h), its engraved face (w, h) fitted inside it, and the engraving's capitals (world).
 * `lift`: how far up the card's face starts over its foot (the plate and the gap).
 */
export function projectPlateSize(size: CrateSize, label: { w: number; h: number }, labelCap: number): { w: number; h: number; face: { w: number; h: number }; cap: number; lift: number } {
  const cw = projectCardSize(size).w;
  const h = cw * PLATE_SHARE;
  const s = Math.min((h - 2 * PLATE_RIM) / label.h, (cw * 0.86 - 2 * PLATE_RIM) / label.w);
  const face = { w: label.w * s, h: label.h * s };
  return { w: face.w + 2 * PLATE_RIM + 0.01, h, face, cap: labelCap * s, lift: h + PLATE_GAP };
}

/** The card's region (one per project crate, by name), on the cards' page. */
export function projectCardRegion(labels: Labels, name: string, size: CrateSize): LabelRegion {
  return labels.region(`crate-card|${name}`, projectCardSize(size), { texelsPerUnit: CARD_TPU, alpha: 'opaque' });
}

export interface ProjectCardOptions extends KitOptions {
  size?: CrateSize;
  /** The card face's texture: its region's key. Without it, blank paper (reviews, tests). */
  face?: string;
  /** The brass plate's engraving: a plate label's key, its size and its capitals' height as made. Without it, blank brass. */
  plate?: { key: string; w: number; h: number; cap: number };
  /** How far over the rim the tray's floor is (its thing sits on it), world units. */
  trayY?: number;
  /** (round two) How much higher the card stands, on two posts under its batten: over the thing on the tray, not behind it. */
  lift?: number;
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
  // (round three) the brass plate stands on the foot, in the middle, and the card stands on the plate
  const pl = o.plate ?? { key: '', w: w * 0.6, h: w * 0.12, cap: w * 0.05 };
  const P = projectPlateSize(size, pl, pl.cap);
  const faceG = transform(sheet({ w, h, t, nx: 6, ny: 2, lift: (u) => bow(u) }), T(0, P.lift + h / 2, 0));
  const backG = transform(sheet({ w, h, t, nx: 6, ny: 2, lift: (u) => bow(u), back: true }), T(0, P.lift + h / 2, 0));
  card.add(o.face ? texturedPart('paper', faceG, o.face) : part('paper', faceG, 'paper', { seed, shade: 0.98 }));
  card.add(part('paper', backG, 'paper', { seed: seed + 1, shade: 0.92 }));
  // the plate: a thick brass plate, bevelled, two screw heads at its ends, its engraved face let into it
  const plateAt = T(0, P.h / 2 + 0.002, t + 0.004);
  card.add(part('brass', transform(bevelBox({ min: [-P.w / 2, -P.h / 2, -0.004], max: [P.w / 2, P.h / 2, 0.0026], c: 0.0028, omit: ['nz'] }), plateAt), 'brass', { seed: seed + 2, shade: 0.8 }));
  for (const sx of [-1, 1]) {
    const screw = transform(bevelBox({ min: [-0.0045, -0.0045, 0], max: [0.0045, 0.0045, 0.0022], c: 0.0016, omit: ['nz'] }), chain(plateAt, T(sx * (P.w / 2 - 0.0065), 0, 0.0026)));
    card.add(part('brass', screw, 'brass', { seed: seed + 7, shade: 0.6 }));
  }
  const plateFace = transform(sheet({ w: P.face.w, h: P.face.h, t: 0.001, nx: 1, ny: 1 }), chain(plateAt, T(0, 0, 0.0028)));
  card.add(o.plate?.key ? noShadow([texturedPart('brass', plateFace, o.plate.key)]) : [part('brass', plateFace, 'brass', { shade: 0.9 })]);
  b.socket('plate', { at: [0, 0.026 + P.h / 2, back] });

  // the foot: a batten laid across the walls at the mouth's back, with a saw cut the card stands in (it rises with it)
  const fw = m.w + 0.05;
  // (the card's node leans back; its batten is laid level)
  const batten = transform(bevelBox({ min: [-fw / 2, -0.026, -0.024], max: [fw / 2, 0.004, 0.02], c: 0.004, omit: ['ny'], wear: 0.8 }), new Matrix4().makeRotationX(lean * DEG));
  card.add(part('wood', batten, 'wood-light', { seed: seed + 3, jitter: 0.08, shade: 0.9 }));
  // (round two) lifted over a thing on the tray: two posts from the batten down to the rim
  const lift = o.lift ?? 0;
  if (lift > 0.01) {
    for (const sx of [-1, 1]) {
      const post = transform(bevelBox({ min: [sx * (fw / 2 - 0.03) - 0.012, -0.026 - lift, -0.012], max: [sx * (fw / 2 - 0.03) + 0.012, -0.026, 0.012], c: 0.003, omit: ['ny'] }), new Matrix4().makeRotationX(lean * DEG));
      card.add(part('wood', post, 'wood-light', { seed: seed + 6, jitter: 0.08, shade: 0.85 }));
    }
  }

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

/** A palette token as a canvas colour with alpha (as the crate's tape paints its colours). */
const css = (tk: Token, a = 1): string => `${hex(tk)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

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
/** A row's capitals on the card's face: shares of its width (x, from the left) and height (y, from the top). */
export interface CapBand {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Type the card, and say where its type landed (round three: measured, not judged by eye): the capitals of the title's
 * first row and of the line's first row, as shares of the face.
 */
export function paintProjectCard(region: LabelRegion, words: { title: string; line: string }, seed = 1): { title: CapBand; line: CapBand } {
  const out = { title: { x0: 0, x1: 0, y0: 0, y1: 0 }, line: { x0: 0, x1: 0, y0: 0, y1: 0 } };
  region.draw((ctx, W, H) => {
    const r = labelRng(`crate-card|${seed}|${words.title}`);
    const j = (m: number): number => (r() * 2 - 1) * m;
    // (round two) the stock at the value of the crew's cards: cream index stock aged toward the wood, a little grey,
    // darker at its edges; never the white of the brightest thing on the bench
    ctx.fillStyle = css('paper');
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = css('wood-light', 0.3);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = css('ink', 0.07);
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.25, W * 0.5, H * 0.5, W * 0.72);
    g.addColorStop(0, css('paper', 0));
    g.addColorStop(1, css('wood', 0.22));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const side = W * 0.065;
    const room = W - 2 * side;
    ctx.textBaseline = 'alphabetic';
    // the title large (two lines at most), a red rule, the one line under it (three at most); smaller together until it
    // fits. (The tools are not on the card: at the distance a card is read they cannot be 12 px; the plate opens them.)
    type Row = { text: string; px: number; y: number; a: number };
    const plan = (k: number): { rows: Row[]; rule: number; bottom: number } => {
      const rows: Row[] = [];
      const tp = H * 0.22 * k;
      let px = tp;
      ctx.font = font('type', px);
      let title = wrapPx(ctx, words.title, room);
      while (title.length > 2 && px > tp * 0.6) {
        px *= 0.93;
        ctx.font = font('type', px);
        title = wrapPx(ctx, words.title, room);
      }
      let y = H * 0.07 + px;
      for (const l of title) {
        rows.push({ text: l, px, y, a: 0.96 });
        y += px * 1.12;
      }
      const rule = y - px * 0.7;
      const sp = px * 0.72;
      y += sp * 0.3;
      ctx.font = font('type', sp);
      const lines = wrapPx(ctx, words.line, room);
      for (const l of lines) {
        rows.push({ text: l, px: sp, y, a: 0.9 });
        y += sp * 1.25;
      }
      return { rows, rule, bottom: y - sp * 0.95 };
    };
    let k = 1;
    let p = plan(k);
    while (p.bottom > H * 0.95 && k > 0.4) {
      k *= 0.94;
      p = plan(k);
    }
    // the red rule under the title, faint blue rules under the line (an index card)
    ctx.strokeStyle = css('cable-red', 0.5);
    ctx.lineWidth = Math.max(1, H * 0.007);
    ctx.beginPath();
    ctx.moveTo(side * 0.5, p.rule);
    ctx.lineTo(W - side * 0.5, p.rule + j(H * 0.004));
    ctx.stroke();
    ctx.strokeStyle = css('paint-blue', 0.14);
    ctx.lineWidth = Math.max(1, H * 0.003);
    for (const row of p.rows) {
      if (row.y < p.rule + 2) continue;
      ctx.beginPath();
      ctx.moveTo(side * 0.5, row.y + row.px * 0.28);
      ctx.lineTo(W - side * 0.5, row.y + row.px * 0.28);
      ctx.stroke();
    }
    // letter by letter: a typewriter's baseline wanders, some strikes land a little light
    for (const row of p.rows) {
      ctx.font = font('type', row.px);
      const which = row.y < p.rule ? 'title' : 'line';
      if (out[which].y1 === 0) {
        const cap = ctx.measureText('H').actualBoundingBoxAscent;
        out[which] = { x0: side / W, x1: (side + ctx.measureText(row.text).width) / W, y0: (row.y - cap) / H, y1: row.y / H };
      }
      let cx = side + j(row.px * 0.04);
      for (const ch of row.text) {
        ctx.fillStyle = css('ink', r() < 0.12 ? row.a * 0.85 : row.a);
        ctx.fillText(ch, cx + j(row.px * 0.012), row.y + j(row.px * 0.025));
        cx += ctx.measureText(ch).width;
      }
    }
  });
  return out;
}
