/**
 * The report press's paper, painted (P4 D3; browser only: canvas 2D): one label region (`SHEETS`) for every sheet the
 * press and its envelope show. The printed sheet a ruled head and a row of stamped marks (rows of four, newest last);
 * the gridded sheet a ruled grid, the same marks one to a cell; the blank stock; the envelope's two faces in its paint,
 * the flap's fold lines and the wax seal. Every colour a palette token; no words anywhere (a report with invented text
 * would be an invented fact). The view (view/stations/press.ts) repaints it when what it shows changes; the piece's
 * catalogue entry paints it blank once, so the paper is paper wherever the piece is drawn.
 */
import type { LabelRegion } from '../../../types.ts';
import { hex, paints, type Token } from '../../../palette.ts';
import { rng as labelRng } from '../../../labels/rng.ts';
import { GRID, UV } from './dims.ts';

/** A paint name as the simulation carries it, as a palette token (null: bare). */
export const paintToken = (c: string): Token | null => ((paints as readonly string[]).includes(c) ? (c as Token) : null);
/** A paint name as a palette token for a mark (bare wood: the crate's own light wood). */
const markToken = (c: string): Token => paintToken(c) ?? 'wood-light';
/** A token as a canvas colour with alpha. */
const css = (tk: Token, a = 1): string => `${hex(tk)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

const painted = new WeakSet<LabelRegion>();
/** Paint the region blank (empty holders, bare envelope, no seal) the first time anyone asks for it; a view repaints it after. */
export function paperOnce(region: LabelRegion): LabelRegion {
  if (!painted.has(region)) {
    painted.add(region);
    paintPressPaper(region, { report: null, envelope: 'bare', seal: null });
  }
  return region;
}

/** What the paper shows: the report on the sheets, the envelope's paint and its seal. */
export interface PaperState {
  readonly report: readonly string[] | null;
  readonly envelope: string;
  readonly seal: string | null;
}

/**
 * Paint the press's paper region (browser only: canvas 2D): the two sheets' faces from `report`, the blanks, both faces
 * of the envelope. Every colour a palette token; no words.
 */
export function paintPressPaper(region: LabelRegion, s: PaperState): void {
  region.draw((ctx, W, H) => {
    const rect = (r: readonly [number, number, number, number]): { x: number; y: number; w: number; h: number } => ({ x: r[0] * W, y: (1 - r[3]) * H, w: (r[2] - r[0]) * W, h: (r[3] - r[1]) * H });
    const r = labelRng(`press|${JSON.stringify(s.report)}`);
    const j = (m: number): number => (r() * 2 - 1) * m;
    ctx.fillStyle = css('paper');
    ctx.fillRect(0, 0, W, H);
    // a faint warmth toward each sheet's edges, as stock has
    const stock = (b: { x: number; y: number; w: number; h: number }, tk: Token = 'paper'): void => {
      ctx.fillStyle = css(tk);
      ctx.fillRect(b.x, b.y, b.w, b.h);
      const g = ctx.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.25, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * 0.75);
      g.addColorStop(0, css('wood-light', 0));
      g.addColorStop(1, css('wood-light', 0.2));
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    };
    /** An inked stamp: a filled round, a little uneven, its rim darker and a lighter middle. */
    const stamp = (cx: number, cy: number, rad: number, tk: Token, square = false): void => {
      ctx.save();
      ctx.translate(cx + j(rad * 0.08), cy + j(rad * 0.08));
      ctx.rotate(j(0.25));
      ctx.fillStyle = css(tk, 0.88);
      ctx.beginPath();
      if (square) ctx.rect(-rad, -rad, rad * 2, rad * 2);
      else ctx.ellipse(0, 0, rad, rad * (0.94 + j(0.04)), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = css('ink', 0.22);
      ctx.lineWidth = Math.max(1, rad * 0.14);
      ctx.stroke();
      ctx.fillStyle = css('paper', 0.18);
      ctx.beginPath();
      if (square) ctx.rect(-rad * 0.45, -rad * 0.45, rad * 0.9, rad * 0.9);
      else ctx.arc(0, 0, rad * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const marks = s.report ?? [];
    // the printed sheet: a ruled head (no words), then the marks in rows of four, newest last
    {
      const b = rect(UV.printed);
      stock(b);
      const m = b.w * 0.1;
      ctx.strokeStyle = css('ink', 0.6);
      ctx.lineWidth = Math.max(1, b.h * 0.012);
      ctx.beginPath();
      ctx.moveTo(b.x + m, b.y + b.h * 0.12);
      ctx.lineTo(b.x + b.w - m, b.y + b.h * 0.12 + j(1));
      ctx.stroke();
      ctx.lineWidth = Math.max(1, b.h * 0.005);
      ctx.beginPath();
      ctx.moveTo(b.x + m, b.y + b.h * 0.15);
      ctx.lineTo(b.x + b.w - m, b.y + b.h * 0.15);
      ctx.stroke();
      const cols = 4;
      const cw = (b.w - 2 * m) / cols;
      marks.forEach((c, i) => stamp(b.x + m + cw * (i % cols + 0.5), b.y + b.h * 0.25 + Math.floor(i / cols) * cw * 1.05, cw * 0.38, markToken(c)));
      // a short rule under the last row, so an empty report reads as a report with nothing in it
      ctx.strokeStyle = css('ink', 0.3);
      ctx.lineWidth = Math.max(1, b.h * 0.004);
      ctx.beginPath();
      const y = b.y + b.h * 0.25 + Math.max(1, Math.ceil(marks.length / cols)) * cw * 1.05;
      ctx.moveTo(b.x + m, y);
      ctx.lineTo(b.x + b.w - m, y);
      ctx.stroke();
    }
    // the gridded sheet: a ruled grid, the same marks one to a cell
    {
      const b = rect(UV.gridded);
      stock(b);
      const m = b.w * 0.09;
      const top = b.y + b.h * 0.12;
      const gw = b.w - 2 * m;
      const cw = gw / GRID.cols;
      const gh = cw * GRID.rows;
      ctx.fillStyle = css('teal-light', 0.12);
      ctx.fillRect(b.x + m, top - cw * 0.35, gw, cw * 0.35);
      ctx.strokeStyle = css('paint-blue', 0.5);
      ctx.lineWidth = Math.max(1, b.h * 0.005);
      for (let i = 0; i <= GRID.cols; i++) {
        ctx.beginPath();
        ctx.moveTo(b.x + m + i * cw, top - cw * 0.35);
        ctx.lineTo(b.x + m + i * cw, top + gh);
        ctx.stroke();
      }
      for (let k = -1; k <= GRID.rows; k++) {
        const y = k < 0 ? top - cw * 0.35 : top + k * cw;
        ctx.beginPath();
        ctx.moveTo(b.x + m, y);
        ctx.lineTo(b.x + m + gw, y);
        ctx.stroke();
      }
      marks.forEach((c, i) => stamp(b.x + m + cw * ((i % GRID.cols) + 0.5), top + cw * (Math.floor(i / GRID.cols) + 0.5), cw * 0.3, markToken(c), true));
    }
    // the blank stock
    stock(rect(UV.blank));
    // the envelope: its paint (paper when bare), the flap's fold lines on its back, the wax seal at the flap's tip
    const et = paintToken(s.envelope) ?? 'paper';
    {
      const b = rect(UV.envFace);
      stock(b, et);
    }
    {
      const b = rect(UV.envBack);
      stock(b, et);
      ctx.strokeStyle = css('ink', 0.16);
      ctx.lineWidth = Math.max(1, b.h * 0.012);
      const tip = { x: b.x + b.w / 2, y: b.y + b.h * 0.62 };
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.02, b.y + b.h * 0.04);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(b.x + b.w * 0.98, b.y + b.h * 0.04);
      ctx.stroke();
      ctx.strokeStyle = css('ink', 0.08);
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.02, b.y + b.h * 0.96);
      ctx.lineTo(tip.x, b.y + b.h * 0.5);
      ctx.lineTo(b.x + b.w * 0.98, b.y + b.h * 0.96);
      ctx.stroke();
      if (s.seal !== null) {
        const tk = markToken(s.seal);
        const rad = b.h * 0.19;
        ctx.fillStyle = css(tk);
        ctx.beginPath();
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          const rr = rad * (1 + 0.1 * Math.sin(k * 2.7));
          if (k === 0) ctx.moveTo(tip.x + Math.cos(a) * rr, tip.y + Math.sin(a) * rr);
          else ctx.lineTo(tip.x + Math.cos(a) * rr, tip.y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = css('ink', 0.3);
        ctx.lineWidth = Math.max(1, rad * 0.12);
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, rad * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
}

