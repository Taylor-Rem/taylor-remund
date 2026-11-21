/**
 * The colours of the paperwork pages (REWRITE.md § A, § F1), emitted by the
 * Paper layout as CSS custom properties on :root. They come from the
 * workshop's palette (src/workshop/view/palette.ts), so the pages and the
 * bench are one place: no colour is typed here.
 *
 * The pages need three tones the palette does not have; they are DERIVED
 * here, and only here, by mixing two palette tokens in sRGB:
 *
 * - `ink-soft`: secondary text (subtitles, meta lines, dates). Ink 78% on
 *   paper; contrast against paper stays above 7:1.
 * - `rule`: hairline rules between entries. Ink 22% on paper (not text).
 * - `paper-deep`: the callout and photo-mat ground, a little darker than the
 *   sheet. Paper with 6% of wood.
 *
 * tests/unit/paper/tokens.test.ts holds every text pairing above 4.5:1.
 */
import { palette } from '../workshop/view/palette.ts';
import type { Token } from '../workshop/view/palette.ts';

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** `a` over `b`, `t` of a (0..1), mixed in sRGB. */
export function mix(a: Token, b: Token, t: number): string {
  const x = rgb(palette[a]);
  const y = rgb(palette[b]);
  return toHex([0, 1, 2].map((i) => x[i]! * t + y[i]! * (1 - t)) as [number, number, number]);
}

/** Every colour the paper pages use, by CSS name (`--paper`, `--ink`, ...). */
export const paperColours = {
  paper: palette.paper,
  ink: palette.ink,
  /** Links: the machines' teal. */
  link: palette['teal-panel'],
  /** The one red mark (the stencil name's underline, the callout's edge). */
  mark: palette['cable-red'],
  brass: palette.brass,
  'ink-soft': mix('ink', 'paper', 0.78),
  rule: mix('ink', 'paper', 0.22),
  'paper-deep': mix('wood', 'paper', 0.06),
} as const;

/**
 * On paper the pages print black on white (the brief for the printed
 * résumé): the same names, plain CSS keywords, no palette tone.
 */
export const printColours: Record<keyof typeof paperColours, string> = {
  paper: 'white',
  ink: 'black',
  link: 'black',
  mark: 'black',
  brass: 'gray',
  'ink-soft': 'black',
  rule: 'gray',
  'paper-deep': 'white',
};

const decls = (c: Record<string, string>): string => Object.entries(c).map(([k, v]) => `--${k}:${v}`).join(';');

/** `:root { --paper: #...; ... }` and its print twin, for the layout's inline style. */
export function tokensCss(): string {
  return `:root{${decls(paperColours)}}@media print{:root{${decls(printColours)}}}`;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex).map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
