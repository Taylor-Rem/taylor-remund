/**
 * How the fascia's words are fitted to the board (pure; runs in Node), the
 * way a sign writer would: as big as the board allows, on one line if that
 * keeps them big, otherwise on two lines broken at a space; letters
 * condensed a little before they are made smaller, and never condensed past
 * MIN_CONDENSE. Up to MAX_CHARS characters.
 *
 * The 12 px rule (REWRITE.md § G, art-direction § 7): `capPx` of the chosen
 * cap height at the default view must be at least 12; `fitWords` reports it
 * and the unit tests hold every length up to MAX_CHARS to it.
 */
import { WORDS } from './dims.ts';
import { capPx, DEFAULT_VIEW } from '../../../labels/layout.ts';
import { SUBSET } from '../../../labels/fonts.ts';

export const MAX_CHARS = 16;
/** Narrowest the letters may be squeezed (fraction of their natural width). */
export const MIN_CONDENSE = 0.6;
/** Squeeze a sign writer uses without thinking about it. */
export const EASY_CONDENSE = 0.82;
/** Capitals no bigger than this (a short word must not fill the board top to bottom). */
export const MAX_CAP = 0.42;
/** Smallest capital worth painting before squeezing harder: the 12 px rule with a margin (0.21 is the line). */
export const MIN_CAP = 0.235;
/** Line pitch in cap heights, and the drop shade (cap heights) the painter adds below and right. */
export const LINE_PITCH = 1.24;
export const SHADE = 0.08;

/** Advance of a character in cap units (as the labels' `advance` gives it). */
export type Advance = (ch: string, next?: string) => number;

export interface WordsLayout {
  lines: string[];
  /** Capital height, world units. */
  cap: number;
  /** Horizontal squeeze applied to every line (1 = natural). */
  condense: number;
  /** Each line's natural width in cap units (before condensing). */
  widths: number[];
  /** Baselines, world units down from the top of the words area. */
  baselines: number[];
  /** Capitals in px at the default view (the 12 px rule). */
  px: number;
}

/** Clean what a visitor typed into what the board can carry: upper case, single spaces, at most MAX_CHARS. */
export function cleanWords(text: string): string {
  const up = [...text.toUpperCase().replace(/\s+/g, ' ')].filter((c) => SUBSET.sign.includes(c)).join('');
  return up.trim().slice(0, MAX_CHARS).trim();
}

const widthOf = (s: string, adv: Advance): number => {
  let w = 0;
  const ch = [...s];
  ch.forEach((c, i) => {
    w += adv(c, ch[i + 1]);
  });
  return w;
};

/** Every way to put `text` on one or two lines (two-line splits only at spaces). */
function candidates(text: string, inWords: boolean): string[][] {
  const out: string[][] = [[text]];
  for (let i = 1; i < text.length - 1; i++) {
    if (text[i] === ' ') out.push([text.slice(0, i), text.slice(i + 1)]);
    else if (inWords && text[i - 1] !== ' ') out.push([text.slice(0, i), text.slice(i)]);
  }
  return out;
}

/** The face's usable area (world units), after margins and the fascia's lean. */
export function wordsArea(): { w: number; h: number } {
  return { w: WORDS.w - 2 * WORDS.side, h: WORDS.h - 2 * WORDS.vert };
}

/**
 * Fit `text` to the fascia. `adv` measures the painted face; in Node (tests, budgets) pass
 * `estimateAdvance`. Prefers the biggest capitals; between equal sizes, fewer lines.
 */
export function fitWords(text: string, adv: Advance = estimateAdvance): WordsLayout {
  const best = fit(text, adv, false);
  // a long word that cannot be read on one line is broken where it fits, as a sign writer would
  return best.px >= 12 ? best : fit(text, adv, true);
}

function fit(text: string, adv: Advance, inWords: boolean): WordsLayout {
  const t = cleanWords(text);
  const area = wordsArea();
  let best: WordsLayout | null = null;
  for (const lines of candidates(t, inWords)) {
    const n = lines.length;
    // height: n capitals, (n - 1) line gaps, the shade under the last line
    const capH = area.h / (1 + (n - 1) * LINE_PITCH + SHADE);
    const widths = lines.map((l) => widthOf(l, adv));
    const widest = Math.max(...widths) + SHADE;
    // a single short word must not fill the board top to bottom: cap the size
    let cap = Math.min(capH, MAX_CAP);
    let condense = 1;
    if (widest * cap > area.w) {
      // squeeze a little (a sign writer's condensed letters) before going smaller ...
      condense = area.w / (widest * cap);
      if (condense < EASY_CONDENSE) {
        cap = Math.max(area.w / (widest * EASY_CONDENSE), Math.min(cap, MIN_CAP));
        condense = area.w / (widest * cap);
        // ... and squeeze hard only to stay readable
        if (condense < MIN_CONDENSE) {
          condense = MIN_CONDENSE;
          cap = area.w / (widest * MIN_CONDENSE);
        }
      }
    }
    const block = cap * (1 + (n - 1) * LINE_PITCH + SHADE);
    const top = (area.h - block) / 2;
    const baselines = lines.map((_, i) => WORDS.vert + top + cap * (1 + i * LINE_PITCH));
    const layout: WordsLayout = { lines, cap, condense, widths, baselines, px: capPx(cap, 'front', { pxPerUnit: DEFAULT_VIEW.pxPerUnit, pitchDeg: DEFAULT_VIEW.pitchDeg - WORDS.leanDeg }) };
    const balance = (l: WordsLayout): number => Math.min(...l.widths) / Math.max(...l.widths);
    const better =
      !best ||
      cap > best.cap * 1.04 ||
      (cap > best.cap * 0.96 &&
        (n < best.lines.length || (n === best.lines.length && (balance(layout) > balance(best) + 0.05 || (balance(layout) > balance(best) - 0.05 && condense > best.condense)))));
    if (better) best = layout;
  }
  return best!;
}

/**
 * Advances of the sign face (Alfa Slab One) in cap units, measured on the labels dev page:
 * about 1.0 for most capitals, I and J narrow, M and W wide, a space 0.45.
 */
export function estimateAdvance(ch: string): number {
  if (ch === ' ') return 0.42;
  if ('IJ1.,:;!\''.includes(ch)) return 0.6;
  if ('MW'.includes(ch)) return 1.38;
  if ('ABCDGHKNOQRUVXY0234567890&'.includes(ch)) return 1.08;
  return 0.98;
}
