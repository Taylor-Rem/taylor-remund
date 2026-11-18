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
 *  - PICTURES: five simple drawn pictures for the window's drum and its blank, the OPEN and
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
import { faceV, CELLS, PICTURES_TEX } from './atlas.ts';
import { PICTURES, type WindowPicture } from './content.ts';
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

/** A canvas style from bytes: '#rrggbbaa' (every colour here is a palette token or a mix of two). */
const css = (r: number, g: number, b: number, a: number): string =>
  '#' + [r, g, b, Math.round(Math.max(0, Math.min(1, a)) * 255)].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const rgba = (t: Token, a = 1): string => {
  const n = parseInt(hex(t).slice(1), 16);
  return css((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
};
const mixHex = (a: Token, b: Token, t: number, alpha = 1): string => {
  const p = parseInt(hex(a).slice(1), 16), q = parseInt(hex(b).slice(1), 16);
  const c = (s: number): number => ((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t;
  return css(c(16), c(8), c(0), alpha);
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


type Draw = (ctx: Ctx, w: number, h: number) => void;

const outline = (ctx: Ctx, w: number): void => {
  ctx.strokeStyle = rgba('ink', 0.95);
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
};

const DRAW: Record<WindowPicture, Draw> = {
  mountains(ctx, w, h) {
    const s = Math.min(w, h);
    // a pale sky, three ranges of cut-out mountains, nearest darkest, snow on the far peaks
    ctx.fillStyle = mixHex('paper', 'teal-light', 0.22);
    ctx.fillRect(0, 0, w, h);
    const range = (pts: Array<[number, number]>, fill: string): void => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (const [x, y] of pts) ctx.lineTo(x * w, y * h);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      outline(ctx, s * 0.018);
      ctx.stroke();
    };
    range([[0, 0.55], [0.2, 0.3], [0.33, 0.45], [0.55, 0.16], [0.78, 0.42], [0.9, 0.33], [1, 0.42]], mixHex('teal-light', 'paper', 0.35));
    // snow caps on the far range
    ctx.fillStyle = rgba('paper');
    ctx.beginPath();
    ctx.moveTo(0.55 * w, 0.16 * h);
    ctx.lineTo(0.62 * w, 0.26 * h);
    ctx.lineTo(0.57 * w, 0.24 * h);
    ctx.lineTo(0.53 * w, 0.28 * h);
    ctx.lineTo(0.49 * w, 0.24 * h);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0.2 * w, 0.3 * h);
    ctx.lineTo(0.25 * w, 0.37 * h);
    ctx.lineTo(0.2 * w, 0.35 * h);
    ctx.lineTo(0.16 * w, 0.36 * h);
    ctx.closePath();
    ctx.fill();
    range([[0, 0.7], [0.15, 0.5], [0.35, 0.68], [0.5, 0.48], [0.7, 0.66], [0.86, 0.52], [1, 0.62]], rgba('teal-light'));
    range([[0, 0.86], [0.25, 0.7], [0.45, 0.82], [0.68, 0.72], [1, 0.84]], rgba('teal-panel'));
  },
  sun(ctx, w, h) {
    const s = Math.min(w, h);
    ctx.fillStyle = rgba('paint-blue');
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.5;
    // rays, alternating long and short
    ctx.fillStyle = rgba('tape-yellow');
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const L = k % 2 ? s * 0.38 : s * 0.46;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - 0.12) * s * 0.2, cy + Math.sin(a - 0.12) * s * 0.2);
      ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      ctx.lineTo(cx + Math.cos(a + 0.12) * s * 0.2, cy + Math.sin(a + 0.12) * s * 0.2);
      ctx.closePath();
      ctx.fill();
      outline(ctx, s * 0.014);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = rgba('tape-yellow');
    ctx.fill();
    outline(ctx, s * 0.022);
    ctx.stroke();
    // a face: two dots and a smile
    ctx.fillStyle = rgba('ink');
    for (const dx of [-0.08, 0.08]) {
      ctx.beginPath();
      ctx.arc(cx + dx * s, cy - 0.04 * s, s * 0.022, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy + 0.01 * s, s * 0.1, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.lineWidth = s * 0.02;
    ctx.stroke();
  },
  boat(ctx, w, h) {
    const s = Math.min(w, h);
    ctx.fillStyle = mixHex('paper', 'teal-light', 0.18);
    ctx.fillRect(0, 0, w, h * 0.66);
    ctx.fillStyle = rgba('paint-blue');
    ctx.fillRect(0, h * 0.66, w, h * 0.34);
    outline(ctx, s * 0.022);
    const mx = w * 0.46;
    ctx.beginPath();
    ctx.moveTo(mx, h * 0.1);
    ctx.lineTo(mx, h * 0.62);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx + s * 0.02, h * 0.12);
    ctx.lineTo(mx + s * 0.34, h * 0.58);
    ctx.lineTo(mx + s * 0.02, h * 0.58);
    ctx.closePath();
    ctx.fillStyle = rgba('paper');
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - s * 0.02, h * 0.2);
    ctx.lineTo(mx - s * 0.26, h * 0.58);
    ctx.lineTo(mx - s * 0.02, h * 0.58);
    ctx.closePath();
    ctx.fillStyle = rgba('tape-yellow');
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx, h * 0.1);
    ctx.lineTo(mx + s * 0.12, h * 0.135);
    ctx.lineTo(mx, h * 0.17);
    ctx.fillStyle = rgba('cable-red');
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.14, h * 0.61);
    ctx.lineTo(w * 0.84, h * 0.61);
    ctx.quadraticCurveTo(w * 0.75, h * 0.79, w * 0.64, h * 0.8);
    ctx.lineTo(w * 0.3, h * 0.8);
    ctx.quadraticCurveTo(w * 0.2, h * 0.75, w * 0.14, h * 0.61);
    ctx.closePath();
    ctx.fillStyle = rgba('cable-red');
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = rgba('paper', 0.85);
    ctx.lineWidth = s * 0.022;
    for (const [y, o] of [[0.87, 0], [0.95, 0.5]] as const) {
      ctx.beginPath();
      for (let i = -1; i < 7; i++) {
        const x = (i + o) * w * 0.18;
        ctx.moveTo(x, h * y);
        ctx.quadraticCurveTo(x + w * 0.045, h * (y - 0.04), x + w * 0.09, h * y);
      }
      ctx.stroke();
    }
  },
  tree(ctx, w, h) {
    const s = Math.min(w, h);
    ctx.fillStyle = mixHex('paper', 'tape-yellow', 0.25);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = rgba('paint-green');
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
    outline(ctx, s * 0.022);
    // trunk
    ctx.beginPath();
    ctx.moveTo(w * 0.46, h * 0.86);
    ctx.lineTo(w * 0.48, h * 0.5);
    ctx.lineTo(w * 0.53, h * 0.5);
    ctx.lineTo(w * 0.56, h * 0.86);
    ctx.closePath();
    ctx.fillStyle = rgba('wood');
    ctx.fill();
    ctx.stroke();
    // a round crown of three lobes, an apple or two
    ctx.fillStyle = rgba('paint-green');
    for (const [x, y, r] of [[0.38, 0.38, 0.2], [0.62, 0.38, 0.2], [0.5, 0.24, 0.22]] as const) {
      ctx.beginPath();
      ctx.arc(w * x, h * y, s * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.36, s * 0.2, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, y] of [[0.4, 0.3], [0.6, 0.42], [0.52, 0.18]] as const) {
      ctx.beginPath();
      ctx.arc(w * x, h * y, s * 0.035, 0, Math.PI * 2);
      ctx.fillStyle = rgba('cable-red');
      ctx.fill();
      outline(ctx, s * 0.012);
      ctx.stroke();
    }
  },
  house(ctx, w, h) {
    const s = Math.min(w, h);
    ctx.fillStyle = mixHex('paper', 'teal-light', 0.2);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = rgba('paint-green');
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    outline(ctx, s * 0.022);
    const x0 = w * 0.26, x1 = w * 0.74, y0 = h * 0.46, y1 = h * 0.86;
    // chimney, then the walls, then the roof over them
    ctx.fillStyle = rgba('cable-red');
    ctx.fillRect(w * 0.6, h * 0.16, w * 0.07, h * 0.2);
    ctx.strokeRect(w * 0.6, h * 0.16, w * 0.07, h * 0.2);
    ctx.fillStyle = rgba('paper');
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.beginPath();
    ctx.moveTo(x0 - w * 0.06, y0 + h * 0.02);
    ctx.lineTo(w * 0.5, h * 0.18);
    ctx.lineTo(x1 + w * 0.06, y0 + h * 0.02);
    ctx.closePath();
    ctx.fillStyle = rgba('cable-red');
    ctx.fill();
    ctx.stroke();
    // a door and two windows, lit
    ctx.fillStyle = rgba('paint-blue');
    ctx.fillRect(w * 0.45, h * 0.64, w * 0.1, h * 0.22);
    ctx.strokeRect(w * 0.45, h * 0.64, w * 0.1, h * 0.22);
    ctx.fillStyle = rgba('tape-yellow');
    for (const x of [0.31, 0.6]) {
      ctx.fillRect(w * x, h * 0.56, w * 0.09, h * 0.11);
      ctx.strokeRect(w * x, h * 0.56, w * 0.09, h * 0.11);
    }
  },
  none(ctx, w, h) {
    // the drum's blank face: bare dark board, so the frame looks empty
    ctx.fillStyle = mixHex('ink', 'wood', 0.35);
    ctx.fillRect(0, 0, w, h);
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
  const sx = W / PICTURES_TEX.w, sy = H / PICTURES_TEX.h;
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
  PICTURES.forEach((id, k) => {
    cell(CELLS.pictures[k]!, (c, w, h) => {
      cardGround(c, w, h);
      DRAW[id](c, w, h);
      if (id !== 'none') cardBorder(c, w, h);
    });
  });
  cell(CELLS.open, (c, w, h) => cardWords(c, w, h, words.open, true));
  cell(CELLS.closed, (c, w, h) => cardWords(c, w, h, words.closed, false));
  upload(tex, ctx);
}
