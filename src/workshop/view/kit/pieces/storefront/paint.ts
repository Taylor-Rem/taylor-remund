/**
 * Painting the storefront's two textures (browser only: canvas 2D).
 *
 * The labels module has no register for a sign whose words change while it
 * hangs, nor for drawn pictures, so the storefront borrows two label slots
 * of the right size (see labels.ts) and paints its own pixels into them:
 *
 *  - WORDS: the fascia's two faces. Hand-painted capitals in the sign face
 *    (cream, an ink keyline, an ink drop shade) on a clear ground, so the
 *    fascia's paint shows round them. Redrawn when a visitor's text changes
 *    the words: only the face turned away from the street is repainted.
 *  - PICTURES: four simple drawn pictures for the window, and the OPEN and
 *    CLOSED faces of the hanging card. Drawn once.
 *
 * Every colour comes from a palette token.
 */
import type { Texture } from 'three';
import { hex, type Token } from '../../../palette.ts';
import { context } from '../../../labels/draw.ts';
import { assertFace, font } from '../../../labels/fonts.ts';
import { advance } from '../../../labels/draw.ts';
import { rng } from '../../../labels/rng.ts';
import { faceV, CELLS } from './atlas.ts';
import { WORDS } from './dims.ts';
import { fitWords, SHADE, type WordsLayout } from './words.ts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Img = { data: Uint8Array; width: number; height: number };

/** The texture's pixels (a DataTexture made by view/labels: rows bottom-up, RGBA8). */
function imageOf(tex: Texture): Img {
  const img = tex.image as Img;
  if (!img || !img.data || !img.width) throw new Error('storefront: the texture slot is not a data texture');
  return img;
}

/** Copy canvas rows (top-down) into the texture (bottom-up), rows y0..y1 of the canvas only. */
function upload(tex: Texture, ctx: Ctx, y0 = 0, y1?: number): void {
  const img = imageOf(tex);
  const w = img.width, h = img.height;
  const end = y1 ?? h;
  const src = ctx.getImageData(0, y0, w, end - y0).data;
  for (let y = y0; y < end; y++) {
    const row = src.subarray((y - y0) * w * 4, (y - y0 + 1) * w * 4);
    img.data.set(row, (h - 1 - y) * w * 4);
  }
  tex.needsUpdate = true;
}

const rgba = (t: Token, a = 1): string => {
  const n = parseInt(hex(t).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const mixHex = (a: Token, b: Token, t: number, alpha = 1): string => {
  const p = parseInt(hex(a).slice(1), 16), q = parseInt(hex(b).slice(1), 16);
  const c = (s: number): number => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t);
  return `rgba(${c(16)},${c(8)},${c(0)},${alpha})`;
};

let capRatio = 0;
function signCapRatio(): number {
  if (!capRatio) {
    const c = context(8, 8);
    assertFace(c, 'sign', 'H');
    c.font = font('sign', 100);
    capRatio = c.measureText('H').actualBoundingBoxAscent / 100;
  }
  return capRatio;
}

/** The words' layout with the real face's advances (browser). */
export function layoutWords(text: string): WordsLayout {
  return fitWords(text, advance('sign'));
}

// ---- words -------------------------------------------------------------------------

/**
 * Paint `text` on one face of the words texture (the other face is left as it is).
 * The face's half of the texture spans the whole fascia: WORDS.w × WORDS.h.
 */
export function paintWords(tex: Texture, face: 'A' | 'B', text: string, seed = 1): WordsLayout {
  const img = imageOf(tex);
  const W = img.width, H = img.height;
  const [v0, v1] = faceV(face);
  const y0 = Math.round((1 - v1) * H), y1 = Math.round((1 - v0) * H);
  const fh = y1 - y0;
  const ctx = context(W, H);
  ctx.clearRect(0, 0, W, H);
  const lay = layoutWords(text);
  const sx = W / WORDS.w, sy = fh / WORDS.h;
  const capPx = lay.cap * sy;
  const px = capPx / signCapRatio();
  const adv = advance('sign');
  const r = rng(`storefront|words|${seed}|${text}`);
  const j = (m: number): number => (r() * 2 - 1) * m;
  // the ground: clear (the fascia's paint shows); a faint ghost of brush wash round the letters is the shade's job
  const layers: Array<{ style: string; dx: number; dy: number; stroke: number; fill: boolean }> = [
    // the drop shade, solid ink, down and right
    { style: rgba('ink', 0.92), dx: SHADE * 0.75, dy: SHADE, stroke: 0.1, fill: true },
    // the keyline round the face
    { style: rgba('ink', 1), dx: 0, dy: 0, stroke: 0.1, fill: false },
    // the face: cream, a touch warmer toward the foot of each letter
    { style: '', dx: 0, dy: 0, stroke: 0, fill: true },
  ];
  lay.lines.forEach((line, li) => {
    const chars = [...line];
    const natural = chars.reduce((s, c, i) => s + adv(c, chars[i + 1]), 0);
    const lineW = natural * lay.cap * lay.condense;
    // world x of the line's start, centred on the board
    const xs = -lineW / 2;
    const base = lay.baselines[li]!;
    for (const L of layers) {
      let cx = xs;
      chars.forEach((c, i) => {
        const a = adv(c, chars[i + 1]) * lay.cap * lay.condense;
        if (c !== ' ') {
          ctx.save();
          const gx = (cx + WORDS.w / 2) * sx;
          const gy = y0 + base * sy;
          // a steady hand: each capital a touch off
          const rr = rng(`storefront|glyph|${seed}|${li}|${i}|${c}`);
          const ox = (rr() * 2 - 1) * 0.012 * capPx, oy = (rr() * 2 - 1) * 0.015 * capPx, rot = (rr() * 2 - 1) * 0.012;
          ctx.translate(gx + ox + L.dx * capPx * (sx / sy), gy + oy + L.dy * capPx);
          ctx.rotate(rot);
          ctx.scale(lay.condense * (sx / sy), 1);
          ctx.font = font('sign', px);
          ctx.textBaseline = 'alphabetic';
          if (L.style === '') {
            const g = ctx.createLinearGradient(0, -capPx, 0, 0);
            g.addColorStop(0, mixHex('paper', 'amber', 0.04));
            g.addColorStop(1, mixHex('paper', 'amber', 0.28));
            ctx.fillStyle = g;
            ctx.fillText(c, 0, 0);
          } else {
            ctx.fillStyle = L.style;
            ctx.strokeStyle = L.style;
            ctx.lineJoin = 'round';
            ctx.lineWidth = L.stroke * capPx;
            ctx.strokeText(c, 0, 0);
            if (L.fill) ctx.fillText(c, 0, 0);
          }
          ctx.restore();
        }
        cx += a;
      });
    }
  });
  void j;
  upload(tex, ctx, y0, y1);
  return lay;
}

// ---- pictures ---------------------------------------------------------------------

/** The picture ids, in drum order. */
export const PICTURE_IDS = ['teapot', 'boat', 'bicycle', 'flower'] as const;
export type PictureId = (typeof PICTURE_IDS)[number];

type Draw = (ctx: Ctx, w: number, h: number) => void;

const outline = (ctx: Ctx, w: number): void => {
  ctx.strokeStyle = rgba('ink', 0.95);
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
};

const DRAW: Record<PictureId, Draw> = {
  teapot(ctx, w, h) {
    const s = Math.min(w, h);
    const cx = w * 0.5, cy = h * 0.6;
    // a table line
    ctx.fillStyle = mixHex('paper', 'wood-light', 0.45);
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
    outline(ctx, s * 0.025);
    // spout
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.2, cy + s * 0.04);
    ctx.quadraticCurveTo(cx + s * 0.33, cy - s * 0.02, cx + s * 0.4, cy - s * 0.2);
    ctx.lineTo(cx + s * 0.44, cy - s * 0.17);
    ctx.quadraticCurveTo(cx + s * 0.38, cy + s * 0.08, cx + s * 0.22, cy + s * 0.14);
    ctx.closePath();
    ctx.fillStyle = rgba('paint-blue');
    ctx.fill();
    ctx.stroke();
    // handle
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.27, cy, s * 0.1, s * 0.12, 0, 0, Math.PI * 2);
    ctx.lineWidth = s * 0.055;
    ctx.strokeStyle = rgba('ink');
    ctx.stroke();
    ctx.lineWidth = s * 0.03;
    ctx.strokeStyle = rgba('paint-blue');
    ctx.stroke();
    outline(ctx, s * 0.025);
    // body
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.27, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba('paint-blue');
    ctx.fill();
    ctx.stroke();
    // a band of pattern round its belly
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.27, s * 0.2, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = rgba('paper', 0.9);
    ctx.fillRect(cx - s * 0.3, cy - s * 0.03, s * 0.6, s * 0.06);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx + i * s * 0.075, cy, s * 0.016, 0, Math.PI * 2);
      ctx.fillStyle = rgba('cable-red');
      ctx.fill();
    }
    // shine
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.1, cy - s * 0.1, s * 0.07, s * 0.035, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba('paper', 0.55);
    ctx.fill();
    ctx.restore();
    // lid and knob
    ctx.beginPath();
    ctx.ellipse(cx, cy - s * 0.2, s * 0.13, s * 0.045, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = rgba('paint-blue');
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.27, s * 0.035, 0, Math.PI * 2);
    ctx.fillStyle = rgba('tape-yellow');
    ctx.fill();
    ctx.stroke();
    // steam
    ctx.strokeStyle = rgba('steel', 0.8);
    ctx.lineWidth = s * 0.02;
    for (const dx of [0.38, 0.45]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * dx, cy - s * 0.26);
      ctx.bezierCurveTo(cx + s * (dx - 0.05), cy - s * 0.32, cx + s * (dx + 0.05), cy - s * 0.37, cx + s * dx, cy - s * 0.43);
      ctx.stroke();
    }
  },
  boat(ctx, w, h) {
    const s = Math.min(w, h);
    // sky, sea
    ctx.fillStyle = mixHex('paper', 'teal-light', 0.18);
    ctx.fillRect(0, 0, w, h * 0.66);
    ctx.beginPath();
    ctx.arc(w * 0.8, h * 0.2, s * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = rgba('tape-yellow');
    ctx.fill();
    ctx.fillStyle = rgba('paint-blue');
    ctx.fillRect(0, h * 0.66, w, h * 0.34);
    outline(ctx, s * 0.022);
    // mast and sails
    const mx = w * 0.46;
    ctx.beginPath();
    ctx.moveTo(mx, h * 0.12);
    ctx.lineTo(mx, h * 0.62);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx + s * 0.02, h * 0.14);
    ctx.lineTo(mx + s * 0.3, h * 0.58);
    ctx.lineTo(mx + s * 0.02, h * 0.58);
    ctx.closePath();
    ctx.fillStyle = rgba('paper');
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - s * 0.02, h * 0.22);
    ctx.lineTo(mx - s * 0.22, h * 0.58);
    ctx.lineTo(mx - s * 0.02, h * 0.58);
    ctx.closePath();
    ctx.fillStyle = rgba('tape-yellow');
    ctx.fill();
    ctx.stroke();
    // a pennant
    ctx.beginPath();
    ctx.moveTo(mx, h * 0.12);
    ctx.lineTo(mx + s * 0.1, h * 0.15);
    ctx.lineTo(mx, h * 0.18);
    ctx.fillStyle = rgba('cable-red');
    ctx.fill();
    // hull
    ctx.beginPath();
    ctx.moveTo(w * 0.18, h * 0.62);
    ctx.lineTo(w * 0.8, h * 0.62);
    ctx.quadraticCurveTo(w * 0.72, h * 0.78, w * 0.62, h * 0.79);
    ctx.lineTo(w * 0.3, h * 0.79);
    ctx.quadraticCurveTo(w * 0.22, h * 0.74, w * 0.18, h * 0.62);
    ctx.closePath();
    ctx.fillStyle = rgba('cable-red');
    ctx.fill();
    ctx.stroke();
    // waves
    ctx.strokeStyle = rgba('paper', 0.85);
    ctx.lineWidth = s * 0.02;
    for (const [y, o] of [[0.86, 0], [0.94, 0.5]] as const) {
      ctx.beginPath();
      for (let i = -1; i < 7; i++) {
        const x = (i + o) * w * 0.18;
        ctx.moveTo(x, h * y);
        ctx.quadraticCurveTo(x + w * 0.045, h * (y - 0.04), x + w * 0.09, h * y);
      }
      ctx.stroke();
    }
  },
  bicycle(ctx, w, h) {
    const s = Math.min(w, h);
    ctx.fillStyle = mixHex('paper', 'tape-yellow', 0.3);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = mixHex('paper', 'wood-light', 0.4);
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    const r = s * 0.2;
    const ax = w * 0.27, bx = w * 0.73, y = h * 0.64;
    // wheels: a fat tyre, spokes
    for (const x of [ax, bx]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.05;
      ctx.strokeStyle = rgba('ink');
      ctx.stroke();
      ctx.lineWidth = s * 0.008;
      ctx.strokeStyle = rgba('steel');
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * r * 0.9, y - Math.sin(a) * r * 0.9);
        ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
        ctx.stroke();
      }
    }
    // frame
    const crank = [w * 0.48, y] as const;
    const seat = [w * 0.42, h * 0.36] as const;
    const head = [w * 0.66, h * 0.36] as const;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s * 0.04;
    ctx.strokeStyle = rgba('paint-green');
    ctx.beginPath();
    ctx.moveTo(ax, y);
    ctx.lineTo(crank[0], crank[1]);
    ctx.lineTo(head[0], head[1]);
    ctx.lineTo(seat[0], seat[1]);
    ctx.lineTo(ax, y);
    ctx.moveTo(seat[0], seat[1]);
    ctx.lineTo(crank[0], crank[1]);
    ctx.moveTo(head[0] - s * 0.01, head[1] - s * 0.02);
    ctx.lineTo(bx, y);
    ctx.stroke();
    // saddle, bars
    ctx.lineWidth = s * 0.045;
    ctx.strokeStyle = rgba('ink');
    ctx.beginPath();
    ctx.moveTo(seat[0] - s * 0.07, seat[1] - s * 0.05);
    ctx.lineTo(seat[0] + s * 0.05, seat[1] - s * 0.05);
    ctx.moveTo(head[0] - s * 0.03, head[1] - s * 0.09);
    ctx.lineTo(head[0] + s * 0.07, head[1] - s * 0.07);
    ctx.stroke();
    ctx.lineWidth = s * 0.025;
    ctx.beginPath();
    ctx.moveTo(head[0], head[1]);
    ctx.lineTo(head[0], head[1] - s * 0.08);
    ctx.moveTo(seat[0], seat[1]);
    ctx.lineTo(seat[0] - s * 0.01, seat[1] - s * 0.05);
    ctx.stroke();
    // the chainring
    ctx.beginPath();
    ctx.arc(crank[0], crank[1], s * 0.05, 0, Math.PI * 2);
    ctx.fillStyle = rgba('brass');
    ctx.fill();
    ctx.lineWidth = s * 0.015;
    ctx.stroke();
  },
  flower(ctx, w, h) {
    const s = Math.min(w, h);
    ctx.fillStyle = mixHex('paper', 'paint-green', 0.12);
    ctx.fillRect(0, 0, w, h);
    outline(ctx, s * 0.022);
    const cx = w * 0.5;
    // stem and leaves
    ctx.strokeStyle = rgba('paint-green');
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.moveTo(cx, h * 0.68);
    ctx.quadraticCurveTo(cx - s * 0.04, h * 0.48, cx, h * 0.3);
    ctx.stroke();
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + sx * s * 0.1, h * 0.52, s * 0.1, s * 0.04, sx * -0.5, 0, Math.PI * 2);
      ctx.fillStyle = rgba('paint-green');
      ctx.fill();
      outline(ctx, s * 0.015);
      ctx.stroke();
    }
    // the flower: petals round a yellow eye
    outline(ctx, s * 0.018);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * s * 0.1, h * 0.28 + Math.sin(a) * s * 0.1, s * 0.075, s * 0.05, a, 0, Math.PI * 2);
      ctx.fillStyle = rgba('cable-red');
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, h * 0.28, s * 0.065, 0, Math.PI * 2);
    ctx.fillStyle = rgba('tape-yellow');
    ctx.fill();
    ctx.stroke();
    // the pot
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.2, h * 0.66);
    ctx.lineTo(cx + s * 0.2, h * 0.66);
    ctx.lineTo(cx + s * 0.15, h * 0.93);
    ctx.lineTo(cx - s * 0.15, h * 0.93);
    ctx.closePath();
    ctx.fillStyle = rgba('paint-orange');
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(cx - s * 0.23, h * 0.63, s * 0.46, h * 0.07);
    ctx.fillStyle = mixHex('paint-orange', 'paper', 0.15);
    ctx.fill();
    ctx.stroke();
  },
};

/** A printed card's ground: cream, a darker edge, a thin ruled border. */
function cardGround(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = rgba('paper');
  ctx.fillRect(0, 0, w, h);
}
function cardBorder(ctx: Ctx, w: number, h: number): void {
  const s = Math.min(w, h);
  ctx.strokeStyle = rgba('ink', 0.85);
  ctx.lineWidth = s * 0.025;
  ctx.strokeRect(s * 0.05, s * 0.05, w - s * 0.1, h - s * 0.1);
  // the paper's edge, a little darker
  const g = ctx.createRadialGradient(w / 2, h / 2, s * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, rgba('wood', 0));
  g.addColorStop(1, rgba('wood', 0.28));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** The hanging card's faces: OPEN (red capitals on cream) and CLOSED (cream on ink). */
function cardWords(ctx: Ctx, w: number, h: number, text: string, open: boolean): void {
  ctx.fillStyle = open ? rgba('paper') : mixHex('ink', 'teal-panel', 0.2);
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h);
  ctx.strokeStyle = open ? rgba('cable-red') : rgba('paper', 0.8);
  ctx.lineWidth = s * 0.05;
  ctx.strokeRect(s * 0.1, s * 0.1, w - s * 0.2, h - s * 0.2);
  const t = text.toUpperCase();
  assertFace(ctx, 'sign', t);
  const ratio = signCapRatio();
  // as big as fits: capitals up to 52% of the card's height
  let cap = h * 0.52;
  ctx.font = font('sign', cap / ratio);
  const tw = ctx.measureText(t).width;
  const maxW = w * 0.8;
  const squeeze = Math.min(1, maxW / tw);
  if (squeeze < 0.8) {
    cap *= squeeze / 0.8;
    ctx.font = font('sign', cap / ratio);
  }
  const tw2 = ctx.measureText(t).width;
  const k = Math.min(1, maxW / tw2);
  ctx.save();
  ctx.translate(w / 2, h / 2 + cap / 2);
  ctx.scale(k, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = open ? rgba('cable-red') : rgba('paper');
  ctx.fillText(t, 0, 0);
  ctx.restore();
}

/** Paint the pictures texture: the four pictures and the card's two faces. */
export function paintPictures(tex: Texture, words: { open: string; closed: string }): void {
  const img = imageOf(tex);
  const W = img.width, H = img.height;
  const ctx = context(W, H);
  // the atlas was laid out at PICTURES_TEX; the slot may differ a little: scale
  const sx = W / (CELLS.pictures[0]!.w * 2), sy = H / (CELLS.pictures[0]!.h * 2 + CELLS.open.h);
  const cell = (c: { x: number; y: number; w: number; h: number }, f: (ctx: Ctx, w: number, h: number) => void): void => {
    const x = Math.round(c.x * sx), y = Math.round(c.y * sy), w = Math.round(c.w * sx), h = Math.round(c.h * sy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x, y);
    f(ctx, w, h);
    ctx.restore();
  };
  PICTURE_IDS.forEach((id, k) => {
    cell(CELLS.pictures[k]!, (c, w, h) => {
      cardGround(c, w, h);
      DRAW[id](c, w, h);
      cardBorder(c, w, h);
    });
  });
  cell(CELLS.open, (c, w, h) => cardWords(c, w, h, words.open, true));
  cell(CELLS.closed, (c, w, h) => cardWords(c, w, h, words.closed, false));
  upload(tex, ctx);
}
