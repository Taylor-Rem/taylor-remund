/**
 * Painting the registers. Browser only (canvas 2D for the glyphs, then the
 * pure raster ops in raster.ts for everything a hand, a press, a spray can
 * or a graver would do). Each painter returns RGBA bytes, rows top to
 * bottom; index.ts uploads them.
 */
import type { Token } from '../palette.ts';
import type { RGB } from './colour.ts';
import { mix, put, rgb, scale } from './colour.ts';
import type { FaceRole } from './fonts.ts';
import { assertFace, font } from './fonts.ts';
import type { Advance, PhoneMessage, Plan, TapeColour } from './layout.ts';
import { PROPORTIONS } from './layout.ts';
import type { Gray } from './raster.ts';
import { blur, clamp01, displace, fbm, gray, heightToNormal, map, smoothstep, valueNoise } from './raster.ts';
import type { Rng } from './rng.ts';
import { jitter } from './rng.ts';

export interface Painted {
  w: number;
  h: number;
  color: Uint8Array;
  normal: Uint8Array | null;
  /** G = roughness, B = metalness (three.js reads those channels), R unused. Same size as color. */
  rough: Uint8Array | null;
  /** True when the colour map has meaningful alpha (cut tape ends, torn paper, stencils). */
  alpha: boolean;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function context(w: number, h: number): Ctx {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    if (c) return c;
  }
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const c = el.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('labels: no 2D canvas');
  return c;
}

/** A grey level as a canvas style (for masks, which are not colours). */
const level = (v: number): string => '#' + Math.round(v).toString(16).padStart(2, '0').repeat(3);

function readGray(ctx: Ctx, w: number, h: number): Gray {
  const src = ctx.getImageData(0, 0, w, h).data;
  const g = gray(w, h);
  for (let i = 0; i < w * h; i++) g.d[i] = src[i * 4]! / 255;
  return g;
}

// ---- metrics ----------------------------------------------------------------

const metricsCache = new Map<FaceRole, { capRatio: number; ctx: Ctx }>();

function metrics(role: FaceRole): { capRatio: number; ctx: Ctx } {
  let m = metricsCache.get(role);
  if (!m) {
    const ctx = context(8, 8);
    assertFace(ctx, role, 'H');
    ctx.font = font(role, 100);
    const capRatio = ctx.measureText('H').actualBoundingBoxAscent / 100;
    m = { capRatio, ctx };
    metricsCache.set(role, m);
  }
  return m;
}

/** Advance in cap units, kerned against the next character when given. */
export function advance(role: FaceRole): Advance {
  const { capRatio, ctx } = metrics(role);
  const em = 100 * capRatio;
  return (ch, next) => {
    ctx.font = font(role, 100);
    if (next === undefined || next === ' ') return ctx.measureText(ch).width / em;
    return (ctx.measureText(ch + next).width - ctx.measureText(next).width) / em;
  };
}

/** Throws if any glyph of `text` would come from a fallback face. */
export function checkText(role: FaceRole, text: string): void {
  assertFace(metrics(role).ctx, role, text);
}

/** Draw a plan's glyphs in white on black and read them back as a mask. */
function glyphMask(plan: Plan, role: FaceRole, alpha?: (lineIndex: number, glyphIndex: number) => number, extra?: (ctx: Ctx) => void): Gray {
  const { w, h } = plan.px;
  const ctx = context(w, h);
  ctx.fillStyle = level(0);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = level(255);
  ctx.strokeStyle = level(255);
  const px = plan.capTexels / metrics(role).capRatio;
  ctx.font = font(role, px);
  ctx.textBaseline = 'alphabetic';
  plan.lines.forEach((line, li) => {
    line.glyphs.forEach((g, gi) => {
      ctx.save();
      ctx.globalAlpha = alpha ? alpha(li, gi) : 1;
      const x = line.left + g.x * plan.capTexels;
      const y = line.baseline + g.y * plan.capTexels;
      // rotate and scale about the glyph's centre on the baseline
      const half = (ctx.measureText(g.ch).width * g.scale) / 2;
      ctx.translate(x + half, y - plan.capTexels / 2);
      ctx.rotate(g.rot);
      ctx.scale(g.scale, g.scale);
      ctx.translate(-half / g.scale, plan.capTexels / 2);
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    });
  });
  extra?.(ctx);
  return readGray(ctx, w, h);
}

// ---- label tape ----------------------------------------------------------------

const TAPE_TOKEN: Record<TapeColour, Token> = { black: 'ink', red: 'cable-red', blue: 'paint-blue' };

export function paintTape(plan: Plan, colour: TapeColour, r: Rng): Painted {
  const { w, h } = plan.px;
  const cap = plan.capTexels;
  const base = rgb(TAPE_TOKEN[colour]);
  const letter = rgb('paper');
  const M = glyphMask(plan, 'tape');
  const soft = blur(M, cap * 0.04);
  const wide = blur(M, cap * 0.13);
  const n1 = fbm(r() * 1e6, 4);
  const n2 = valueNoise(r() * 1e6);

  // Cut ends: scissors, a little crooked.
  const lead = plan.lines[0]!.left;
  const trailEnd = lead + plan.lines[0]!.width;
  const leftX = Math.max(2, lead - cap * (PROPORTIONS.tape.lead - 0.08));
  const rightX = Math.min(w - 2, trailEnd + (w - trailEnd) * 0.88);
  const tl = jitter(r, 0.055);
  const tr = jitter(r, 0.065);
  const inside = (x: number, y: number): number => {
    const yc = y - h / 2;
    const a = x - (leftX + yc * tl);
    const b = rightX + yc * tr - x;
    return clamp01(Math.min(a, b) + 0.5);
  };

  const color = new Uint8Array(w * h * 4);
  const rough = new Uint8Array(w * h * 4);
  const height = gray(w, h);
  for (let y = 0; y < h; y++) {
    // The tape's long edges are a hair rounded.
    const edge = smoothstep(0, h * 0.06, Math.min(y, h - 1 - y));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = M.d[i]!;
      const s = soft.d[i]!;
      const halo = Math.max(0, wide.d[i]! - m);
      // Stress whitening: the plastic is stretched most where it bends, so the letters'
      // shoulders are whitest and the tops a touch greyer and blotchy; a faint halo round each.
      const shoulder = 4 * s * (1 - s);
      const blot = 0.8 + 0.2 * n1(x / (cap * 0.22), y / (cap * 0.22));
      const whiten = clamp01(smoothstep(0.12, 0.6, s) * (0.8 + 0.2 * shoulder) * blot + halo * 0.14);
      const sheen = 1 + (n2(x / (cap * 1.6), y / (cap * 0.12)) - 0.5) * 0.08;
      const c = mix(scale(base, sheen), letter, whiten);
      const a = inside(x, y);
      put(color, i, c, a);
      height.d[i] = s * 0.8 + halo * 0.12 + edge * 0.12 + (n2(x / (cap * 0.06), y / (cap * 0.9)) - 0.5) * 0.012;
      // Glossy plastic; the whitened letters are more matte.
      const ro = 0.18 + 0.3 * whiten + (n1(x / cap, y / cap) - 0.5) * 0.06;
      put(rough, i, [255, ro * 255, 0], 1);
    }
  }
  return { w, h, color, normal: heightToNormal(height, cap * 0.11), rough, alpha: true };
}

// ---- brass plate -----------------------------------------------------------------

export function paintPlate(plan: Plan, r: Rng): Painted {
  const { w, h } = plan.px;
  const cap = plan.capTexels;
  const inset = cap * 0.26;
  const radius = cap * 0.22;
  const G = glyphMask(plan, 'tape', undefined, (ctx) => {
    // An engraved border line.
    ctx.lineWidth = cap * 0.075;
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, radius);
    ctx.stroke();
  });
  const groove = blur(G, cap * 0.022);
  const lip = blur(G, cap * 0.06);
  const brass = rgb('brass');
  const fill = mix(rgb('ink'), brass, 0.12);
  const streak = fbm(r() * 1e6, 3);
  const mottle = fbm(r() * 1e6, 4);
  const spots = fbm(r() * 1e6, 3);
  const patina = mix(brass, rgb('wood'), 0.45);
  const color = new Uint8Array(w * h * 4);
  const rough = new Uint8Array(w * h * 4);
  const height = gray(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Brushed: long horizontal streaks, plus slow tarnish.
      const st = streak(x / (cap * 6), y / (cap * 0.035));
      const mo = mottle(x / (cap * 0.9), y / (cap * 0.9));
      const edgeD = Math.min(x, y, w - 1 - x, h - 1 - y) / (cap * 0.35);
      // Tarnish: darker and browner toward the edges and in slow blotches; fingers polish the middle.
      const blotch = smoothstep(0.55, 0.8, spots(x / (cap * 0.5), y / (cap * 0.5)));
      const tarnish = 0.82 + 0.12 * smoothstep(0, 1, edgeD) + (mo - 0.5) * 0.14 - blotch * 0.12;
      let c = mix(scale(brass, tarnish * (0.92 + st * 0.16)), scale(patina, tarnish), clamp01(blotch * 0.5 + (1 - smoothstep(0, 1, edgeD)) * 0.3));
      // The cut edge is burnished bright; the groove is filled with dark paint, worn thin here and there.
      const g = G.d[i]!;
      const lp = Math.max(0, lip.d[i]! - g);
      c = mix(c, scale(brass, 1.3), clamp01(lp * 1.6));
      const filled = smoothstep(0.3, 0.75, g) * (0.82 + 0.18 * smoothstep(0.25, 0.6, mo));
      c = mix(c, scale(fill, 0.85 + mo * 0.3), filled);
      put(color, i, c, 1);
      height.d[i] = 1 - groove.d[i]! * 0.9 + st * 0.012;
      put(rough, i, [255, (0.3 + st * 0.1 + (1 - tarnish) * 0.5) * (1 - filled) * 255 + filled * 0.78 * 255, (1 - filled) * 255], 1);
    }
  }
  return { w, h, color, normal: heightToNormal(height, cap * 0.05), rough, alpha: false };
}

// ---- crate stencil -------------------------------------------------------------------

/** The stencilled up-arrow: a head and a shaft held apart by a bridge. */
function arrowPath(ctx: Ctx, x: number, baseline: number, cap: number, adv: number): void {
  const cx = x + (adv * cap) / 2;
  const top = baseline - cap * 1.12;
  const headH = cap * 0.5;
  const headW = cap * 0.9;
  const shaftW = cap * 0.32;
  const bridge = cap * 0.08;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + headW / 2, top + headH);
  ctx.lineTo(cx - headW / 2, top + headH);
  ctx.closePath();
  ctx.rect(cx - shaftW / 2, top + headH + bridge, shaftW, baseline - (top + headH + bridge));
  ctx.fill();
}

export const ARROW = '↑';
/** Arrow advance in cap units. */
export const ARROW_ADVANCE = 1.0;

export function paintStencil(plan: Plan, paint: Token, r: Rng): Painted {
  const { w, h } = plan.px;
  const cap = plan.capTexels;
  // Glyph mask, with the arrow drawn as a shape (no font has the stencil arrow we want).
  const arrows = plan.lines.flatMap((l) => l.glyphs.filter((g) => g.ch === ARROW).map((g) => ({ g, l })));
  const textPlan: Plan = { ...plan, lines: plan.lines.map((l) => ({ ...l, glyphs: l.glyphs.filter((g) => g.ch !== ARROW) })) };
  const M0 = glyphMask(textPlan, 'stencil', undefined, (ctx) => {
    for (const { g, l } of arrows) {
      ctx.save();
      const x = l.left + g.x * cap;
      const y = l.baseline + g.y * cap;
      ctx.translate(x + (ARROW_ADVANCE * cap) / 2, y - cap / 2);
      ctx.rotate(g.rot);
      ctx.translate(-(x + (ARROW_ADVANCE * cap) / 2), -(y - cap / 2));
      arrowPath(ctx, x, y, cap, ARROW_ADVANCE);
      ctx.restore();
    }
  });
  // The stencil sheet never lies quite flat: edges wander and break.
  const wob = valueNoise(r() * 1e6);
  const f = cap * 0.11;
  const M = displace(
    M0,
    (x, y) => (wob(x / f, y / f) - 0.5) * cap * 0.03,
    (x, y) => (wob(x / f + 31.7, y / f) - 0.5) * cap * 0.03,
  );
  const edgeSoft = blur(M, cap * 0.012);
  const halo = blur(M, cap * 0.045);
  const far = blur(M, cap * 0.18);
  const dens = fbm(r() * 1e6, 4);
  const grain = valueNoise(r() * 1e6);
  const fleck = valueNoise(r() * 1e6);
  // The can is swept one way; the mist leans that way.
  const sweep = jitter(r, 1) > 0 ? 1 : -1;
  const alpha = gray(w, h);
  map(alpha, (i) => {
    const x = i % w;
    const y = (i / w) | 0;
    const m = smoothstep(0.15, 0.85, edgeSoft.d[i]!);
    // Uneven density: heavier where the can lingered, thin where it hurried past.
    const d = dens(x / (cap * 0.55), y / (cap * 0.55));
    const fine = grain(x / (cap * 0.022), y / (cap * 0.022));
    const fl = fleck(x / (cap * 0.008), y / (cap * 0.008));
    let core = m * clamp01(0.5 + d * 0.62) * (0.78 + 0.22 * fine) * (0.9 + 0.1 * fl);
    // Dry patches where the paint skipped.
    if (d < 0.36) core *= smoothstep(0.1, 0.36, d) * 0.55 + 0.45;
    // Overspray: a mist that crept under the stencil's edge, and a wider faint cloud.
    const lean = 1 + 0.35 * sweep * Math.tanh((x - w / 2) / (w / 2));
    const mist = Math.max(0, halo.d[i]! - m) * 0.75 * (0.55 + 0.45 * fine) * lean + Math.max(0, far.d[i]! - m) * 0.16 * fl;
    return clamp01(core + mist);
  });
  // Speckles: droplets thrown wide of the stencil.
  const n = Math.round(((w * h) / (cap * cap)) * 16);
  for (let k = 0; k < n; k++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    const near = far.d[y * w + x]!;
    if (r() > near * 2.5) continue;
    const rad = 0.6 + r() * r() * cap * 0.022;
    const a = 0.25 + r() * 0.55;
    for (let yy = Math.max(0, Math.floor(y - rad)); yy <= Math.min(h - 1, Math.ceil(y + rad)); yy++) {
      for (let xx = Math.max(0, Math.floor(x - rad)); xx <= Math.min(w - 1, Math.ceil(x + rad)); xx++) {
        const dd = Math.hypot(xx - x, yy - y);
        const cov = clamp01(rad + 0.5 - dd) * a;
        const j = yy * w + xx;
        alpha.d[j] = Math.max(alpha.d[j]!, cov);
      }
    }
  }
  const col = rgb(paint);
  const color = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) put(color, i, col, alpha.d[i]!);
  return { w, h, color, normal: null, rough: null, alpha: true };
}

// ---- typed paper -------------------------------------------------------------------

export function paintPaper(plan: Plan, r: Rng): Painted {
  const { w, h } = plan.px;
  const cap = plan.capTexels;
  const slip = plan.register === 'slip';
  // Each strike its own weight; some keys land twice, a hair off.
  const weights = plan.lines.map((l) => l.glyphs.map(() => 0.8 + r() * 0.2));
  const ink = glyphMask(plan, 'type', (li, gi) => weights[li]![gi]!);
  const ghost = glyphMask(
    { ...plan, lines: plan.lines.map((l) => ({ ...l, left: l.left + cap * 0.018, baseline: l.baseline - cap * 0.012 })) },
    'type',
    (li, gi) => ((li * 7 + gi * 13) % 5 === 0 ? 0.45 : 0.14),
  );
  const bleed = blur(ink, cap * 0.012);
  const ribbon = valueNoise(r() * 1e6);
  const fibre = valueNoise(r() * 1e6);
  const mottle = fbm(r() * 1e6, 4);
  const paper = rgb('paper');
  const aged = mix(paper, rgb('wood-light'), 0.35);
  const inkC = mix(rgb('ink'), rgb('paint-blue'), 0.12);
  const rule = mix(paper, rgb('paint-blue'), 0.38);
  const redRule = mix(paper, rgb('cable-red'), 0.55);

  // Rules (card) and perforations / torn edges (slip), as small masks.
  const rules = gray(w, h);
  const redLine = gray(w, h);
  if (!slip) {
    const lw = Math.max(1.2, cap * 0.035);
    const first = plan.lines[0]?.baseline ?? cap * PROPORTIONS.card.top;
    const gap = PROPORTIONS.card.lineGap * cap;
    const red = first - cap * 1.55;
    for (let y = 0; y < h; y++) {
      for (let k = 0; ; k++) {
        const ly = first + cap * 0.22 + k * gap;
        if (ly > h - cap * 0.5) break;
        const cov = clamp01(lw / 2 + 0.5 - Math.abs(y - ly));
        if (cov > 0) for (let x = 0; x < w; x++) rules.d[y * w + x] = Math.max(rules.d[y * w + x]!, cov);
      }
      const cr = clamp01(lw * 0.7 + 0.5 - Math.abs(y - red));
      if (cr > 0) for (let x = 0; x < w; x++) redLine.d[y * w + x] = cr;
    }
  }
  const tearT = valueNoise(r() * 1e6);
  const holeY = cap * 0.62;
  const holePitch = cap * 0.34;
  const holeR = cap * 0.07;

  const color = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const edgeD = Math.min(x, y, w - 1 - x, h - 1 - y) / cap;
      const mo = mottle(x / (cap * 1.4), y / (cap * 1.4));
      const fb = fibre(x / (cap * 0.05), y / (cap * 0.4));
      let c = mix(paper, aged, clamp01(0.55 - edgeD * 0.9) + (mo - 0.5) * 0.25);
      c = scale(c, 0.97 + (mo - 0.5) * 0.06 + (fb - 0.5) * 0.03 - 0.07 * Math.exp(-edgeD / 0.18));
      // Rules sit under the ink, broken where the pen of the printer skipped.
      const rv = rules.d[i]! * (0.75 + 0.25 * fb);
      c = mix(c, rule, rv * 0.8);
      c = mix(c, redRule, redLine.d[i]! * (0.8 + 0.2 * fb));
      // Ink: ribbon texture, a little bleed into the fibres, the odd ghost strike.
      const rb = ribbon(x / (cap * 0.03), y / (cap * 0.03));
      const k = clamp01(Math.max(ink.d[i]! * (0.8 + 0.2 * rb), bleed.d[i]! * 0.55) + ghost.d[i]! * 0.5 * rb);
      c = mix(c, inkC, k * 0.97);
      let a = 1;
      if (slip) {
        // Torn along the top and bottom from a roll, and a perforation line under the top.
        const tear = cap * (0.12 + 0.12 * tearT(x / (cap * 0.12), 0.5)) + (x % Math.round(cap * 0.16) < cap * 0.08 ? cap * 0.04 : 0);
        const tearB = cap * (0.1 + 0.12 * tearT(x / (cap * 0.12), 7.5));
        a = clamp01(Math.min(y - tear, h - 1 - y - tearB) + 0.5);
        const hx = ((x % holePitch) + holePitch) % holePitch - holePitch / 2;
        const hole = Math.hypot(hx, y - holeY) - holeR;
        a = Math.min(a, clamp01(hole + 0.5));
      }
      put(color, i, c, a);
    }
  }
  return { w, h, color, normal: null, rough: null, alpha: slip };
}

// ---- the painted sign --------------------------------------------------------------

export function paintSign(plan: Plan, r: Rng): Painted {
  const { w, h } = plan.px;
  const cap = plan.capTexels;
  const F0 = glyphMask(plan, 'sign');
  const pin = gray(w, h);
  {
    const ctx = context(w, h);
    ctx.fillStyle = level(0);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = level(255);
    ctx.lineWidth = cap * 0.03;
    const ins = cap * 0.16;
    ctx.beginPath();
    ctx.roundRect(ins, ins, w - ins * 2, h - ins * 2, cap * 0.12);
    ctx.stroke();
    pin.d.set(readGray(ctx, w, h).d);
  }
  // A steady hand is still a hand: slow wander along every edge, and a fine tremor.
  const wob = valueNoise(r() * 1e6);
  const trem = valueNoise(r() * 1e6);
  const wf = cap * 0.45;
  const tf = cap * 0.05;
  const dx = (x: number, y: number): number => (wob(x / wf, y / wf) - 0.5) * cap * 0.022 + (trem(x / tf, y / tf) - 0.5) * cap * 0.007;
  const dy = (x: number, y: number): number => (wob(x / wf + 17.3, y / wf) - 0.5) * cap * 0.022 + (trem(x / tf + 5.1, y / tf) - 0.5) * cap * 0.007;
  const F = displace(F0, dx, dy);
  const P = displace(pin, dx, dy);
  // The drop shade: the face pushed down and right, solid all the way.
  const d = Math.round(PROPORTIONS.sign.shade * cap);
  const S = gray(w, h);
  for (let t = 1; t <= d; t++) {
    for (let y = t; y < h; y++) {
      for (let x = t; x < w; x++) {
        const v = F.d[(y - t) * w + (x - t)]!;
        const j = y * w + x;
        if (v > S.d[j]!) S.d[j] = v;
      }
    }
  }
  // A thin keyline round the face, where it meets the shade.
  const O = blur(F, cap * 0.016);
  map(O, (i) => smoothstep(0.04, 0.3, O.d[i]!));
  const ridge = blur(F, cap * 0.035);
  // Which way the brush ran: along each stroke, i.e. across the gradient of a wide blur.
  const flow = blur(F, cap * 0.1);

  const board = mix(rgb('ink'), rgb('teal-panel'), 0.32);
  const amber = mix(rgb('amber'), rgb('wood'), 0.1);
  const amberDeep = mix(rgb('amber'), rgb('cable-red'), 0.3);
  const face = rgb('paper');
  const key = mix(rgb('ink'), board, 0.25);
  const brush = fbm(r() * 1e6, 3);
  const boardBrush = fbm(r() * 1e6, 3);
  const grime = fbm(r() * 1e6, 4);
  const scratches = valueNoise(r() * 1e6);
  const color = new Uint8Array(w * h * 4);
  const rough = new Uint8Array(w * h * 4);
  const height = gray(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Stroke direction from the blurred face's gradient; vertical where it is flat.
      const xl = Math.max(0, x - 2);
      const xr = Math.min(w - 1, x + 2);
      const yu = Math.max(0, y - 2);
      const yd = Math.min(h - 1, y + 2);
      const gx = flow.d[y * w + xr]! - flow.d[y * w + xl]!;
      const gy = flow.d[yd * w + x]! - flow.d[yu * w + x]!;
      const gl = Math.hypot(gx, gy);
      const k = smoothstep(0.004, 0.03, gl);
      let ux = k * (gl > 0 ? -gy / gl : 0);
      let uy = k * (gl > 0 ? gx / gl : 0) + (1 - k);
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul;
      uy /= ul;
      const along = x * ux + y * uy;
      const across = -x * uy + y * ux;
      const br = brush(along / (cap * 2.5), across / (cap * 0.022));
      const bb = boardBrush(x / (cap * 0.9), y / (cap * 0.07));
      const gr = grime(x / (cap * 0.8), y / (cap * 0.8));
      const edgeD = Math.min(x, y, w - 1 - x, h - 1 - y) / cap;
      // Enamel board: brushed on, darker toward the frame where grime collects.
      let c = scale(board, 0.94 + bb * 0.08 + (gr - 0.5) * 0.16 - 0.2 * Math.exp(-edgeD / 0.12));
      const sc = scratches(x / (cap * 1.4), y / (cap * 0.012));
      if (sc > 0.93) c = mix(c, rgb('steel'), (sc - 0.93) * 3);
      // Pinstripe in amber, then the shade, the keyline, the face.
      const pv = smoothstep(0.15, 0.75, P.d[i]!);
      c = mix(c, amber, pv * 0.9);
      const sv = smoothstep(0.15, 0.85, S.d[i]!);
      const diag = clamp01((x + y) / (w + h));
      c = mix(c, scale(mix(amber, amberDeep, 0.2 + 0.35 * diag), 0.88 + br * 0.18), sv);
      const ov = O.d[i]! * (1 - smoothstep(0.3, 0.7, F.d[i]!));
      c = mix(c, key, ov * sv);
      const fv = smoothstep(0.15, 0.85, F.d[i]!);
      // One coat, brushed along the stroke: a little thinner (board showing) where the brush ran dry.
      const thin = smoothstep(0.7, 0.95, br) * 0.07;
      const fc = mix(scale(face, 0.93 + br * 0.06 + (gr - 0.5) * 0.06), board, thin);
      c = mix(c, fc, fv);
      put(color, i, c, 1);
      // Paint has thickness: a raised film, a little ridge where the brush lifted at each edge.
      const paint = Math.max(fv, sv * 0.7, pv * 0.6);
      const edgeRidge = Math.max(0, fv - ridge.d[i]!) * 0.5;
      height.d[i] = paint * 0.5 + edgeRidge + br * 0.03 * paint;
      const ro = paint > 0.5 ? 0.62 + (br - 0.5) * 0.1 : 0.42 + (gr - 0.5) * 0.12;
      put(rough, i, [255, ro * 255, 0], 1);
    }
  }
  return { w, h, color, normal: heightToNormal(height, cap * 0.025), rough, alpha: false };
}

// ---- the phone screen ---------------------------------------------------------------


export function paintPhone(plan: Plan, messages: readonly PhoneMessage[], r: Rng): Painted {
  const { w, h } = plan.px;
  const cap = plan.capTexels;
  const ctx = context(w, h);
  const hexOf = (c: RGB): string => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const bg = mix(rgb('ink'), rgb('teal-deep'), 0.45);
  ctx.fillStyle = hexOf(bg);
  ctx.fillRect(0, 0, w, h);
  // Header: a hairline and Patch's avatar dot (no words: words live in content).
  const headH = cap * 3.2;
  ctx.fillStyle = hexOf(mix(bg, rgb('teal-panel'), 0.6));
  ctx.fillRect(0, 0, w, headH);
  ctx.fillStyle = hexOf(rgb('teal-light'));
  ctx.beginPath();
  ctx.arc(w / 2, headH * 0.5, cap * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexOf(rgb('amber-glow'));
  ctx.beginPath();
  ctx.arc(w / 2, headH * 0.5, cap * 0.32, 0, Math.PI * 2);
  ctx.fill();
  // Composer bar at the bottom.
  const barH = cap * 2.6;
  ctx.strokeStyle = hexOf(mix(bg, rgb('steel'), 0.5));
  ctx.lineWidth = Math.max(1.5, cap * 0.08);
  ctx.beginPath();
  ctx.roundRect(cap * 0.8, h - barH - cap * 0.6, w - cap * 4.2, barH, barH / 2);
  ctx.stroke();
  ctx.fillStyle = hexOf(rgb('paint-blue'));
  ctx.beginPath();
  ctx.arc(w - cap * 1.9, h - cap * 0.6 - barH / 2, barH * 0.45, 0, Math.PI * 2);
  ctx.fill();

  // Bubbles, newest at the bottom.
  const px = cap / metrics('tape').capRatio;
  ctx.font = font('tape', px);
  const maxW = w * 0.8;
  const lineH = cap * 1.75;
  const padX = cap * 0.85;
  const padY = cap * 0.75;
  const laid = messages.map((m) => {
    checkText('tape', m.text);
    const words = m.text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(t).width + padX * 2 > maxW && line) {
        lines.push(line);
        line = wd;
      } else line = t;
    }
    if (line) lines.push(line);
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    return { m, lines, bw: tw + padX * 2, bh: lines.length * lineH + padY * 2 - (lineH - cap * 1.25) };
  });
  let y = h - barH - cap * 1.8;
  for (let k = laid.length - 1; k >= 0; k--) {
    const b = laid[k]!;
    y -= b.bh;
    if (y < headH) break;
    const mine = b.m.from === 'owner';
    const x = mine ? w - cap * 0.8 - b.bw : cap * 0.8;
    const fill = mine ? rgb('paint-blue') : mix(rgb('steel'), rgb('paper'), 0.45);
    ctx.fillStyle = hexOf(fill);
    ctx.beginPath();
    ctx.roundRect(x, y, b.bw, b.bh, cap * 0.9);
    ctx.fill();
    // tail
    ctx.beginPath();
    const tx = mine ? x + b.bw - cap * 0.5 : x + cap * 0.5;
    ctx.moveTo(tx - cap * 0.5, y + b.bh - cap * 0.9);
    ctx.quadraticCurveTo(tx + (mine ? cap * 0.6 : -cap * 0.6), y + b.bh + cap * 0.15, tx + (mine ? cap * 0.9 : -cap * 0.9), y + b.bh);
    ctx.lineTo(tx + cap * 0.5, y + b.bh - cap * 0.6);
    ctx.fill();
    ctx.fillStyle = hexOf(mine ? rgb('paper') : rgb('ink'));
    b.lines.forEach((l, li) => ctx.fillText(l, x + padX, y + padY + cap + li * lineH));
    y -= cap * 0.9;
  }
  void r;
  const img = ctx.getImageData(0, 0, w, h).data;
  return { w, h, color: new Uint8Array(img.buffer.slice(0)), normal: null, rough: null, alpha: false };
}

