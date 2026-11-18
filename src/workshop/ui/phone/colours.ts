/**
 * The phone panel's colours, every one a palette token or a mix of two
 * (view/palette.ts is the only place a colour is typed). They reach the
 * stylesheet as custom properties on the panel's root; phone.css uses
 * nothing else. The mixes are the in-world screen's own (view/labels
 * draw.ts `paintPhone`), so the panel is that screen, held closer.
 */
import { palette, type Token } from '../../view/palette.ts';

type RGB = readonly [number, number, number];

const rgbOf = (token: Token): RGB => {
  const n = parseInt(palette[token].slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** a → b by t, in sRGB (as the in-world screen mixes). */
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as unknown as RGB;
const css = (c: RGB): string => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const t = rgbOf;

const screen = mix(t('ink'), t('teal-deep'), 0.45);

/** Every colour the panel uses, by role. */
export const PHONE_COLOURS = {
  /** The rubber bumper and the keys' rubber. */
  rubber: t('ink'),
  /** A lighter moulding line on the rubber (its lit edge). */
  'rubber-edge': mix(t('ink'), t('steel'), 0.32),
  /** The rubber's shadowed side (a key's skirt). */
  'rubber-deep': mix(t('ink'), t('teal-deep'), 0.25),
  /** The lit screen. */
  screen,
  /** The screen's header band. */
  'screen-head': mix(screen, t('teal-panel'), 0.6),
  /** The text field: the screen a shade darker. */
  field: mix(screen, t('ink'), 0.5),
  /** Hairlines and the empty field's rim on the screen. */
  'screen-rule': mix(screen, t('steel'), 0.5),
  /** Quiet words on the screen (dividers, counts). */
  'screen-quiet': mix(t('steel'), t('paper'), 0.45),
  /** Words on the screen. */
  'screen-text': t('paper'),
  /** The visitor's bubble (the in-world screen's blue, a shade deeper so its paper text reads). */
  mine: mix(t('paint-blue'), t('ink'), 0.18),
  'mine-text': t('paper'),
  /** Patch's slip. */
  patch: mix(t('steel'), t('paper'), 0.62),
  'patch-text': t('ink'),
  /** The slip's lower edge (paper thickness). */
  'patch-edge': mix(mix(t('steel'), t('paper'), 0.62), t('wood'), 0.4),
  /** The second impression of off-register ink. */
  'patch-ghost': mix(t('ink'), mix(t('steel'), t('paper'), 0.62), 0.6),
  /** A refused slip's edge. */
  refused: t('cable-red'),
  /** A ready-made text's key (paper on rubber). */
  key: t('paper'),
  'key-text': t('ink'),
  'key-skirt': mix(t('paper'), t('wood'), 0.45),
  'key-hover': mix(t('paper'), t('amber-glow'), 0.22),
  /** The texts every line answers: dark keys. */
  'key-dark': mix(t('ink'), t('teal-panel'), 0.55),
  'key-dark-text': t('paper'),
  'key-dark-skirt': t('ink'),
  'key-dark-hover': mix(t('ink'), t('teal-panel'), 0.8),
  /** Brass: the side buttons, the close key, the send key. */
  brass: t('brass'),
  'brass-deep': mix(t('brass'), t('wood'), 0.55),
  'brass-lit': mix(t('brass'), t('amber-glow'), 0.5),
  'brass-text': t('ink'),
  /** The label tape on the bumper: embossed capitals on red tape (the cord's red: black tape would vanish on the rubber). */
  tape: t('cable-red'),
  'tape-text': t('paper'),
  'tape-edge': mix(t('cable-red'), t('ink'), 0.35),
  /** The line's lamp: lit while Patch works. */
  lamp: t('amber'),
  'lamp-off': mix(t('brass'), t('ink'), 0.55),
  /** Patch's avatar dot (as on the in-world screen). */
  avatar: t('teal-light'),
  'avatar-eye': t('amber-glow'),
  /** Keyboard focus: a ring that reads on the screen and on the rubber. */
  focus: t('tape-yellow'),
} as const satisfies Record<string, RGB>;

export type PhoneColour = keyof typeof PHONE_COLOURS;

/** `#rrggbb` of a role. */
export const colour = (role: PhoneColour): string => css(PHONE_COLOURS[role]);

/** The custom properties phone.css reads: `--ph-<role>`. */
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of Object.keys(PHONE_COLOURS) as PhoneColour[]) out[`--ph-${role}`] = colour(role);
  return out;
}

/** WCAG 2 contrast ratio of two roles. */
export function contrast(a: PhoneColour, b: PhoneColour): number {
  const lum = (c: RGB): number => {
    const [r, g, bl] = c.map((v) => {
      const s = Math.round(v) / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(PHONE_COLOURS[a]);
  const lb = lum(PHONE_COLOURS[b]);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The text-on-ground pairs the panel uses, each of which must reach 4.5:1 (§ E9). */
export const TEXT_PAIRS: ReadonlyArray<readonly [PhoneColour, PhoneColour]> = [
  ['screen-text', 'screen'],
  ['screen-text', 'screen-head'],
  ['screen-quiet', 'screen'],
  ['screen-quiet', 'field'],
  ['screen-text', 'field'],
  ['screen-quiet', 'key-dark'],
  ['key-text', 'key-hover'],
  ['key-dark-text', 'key-dark-hover'],
  ['mine-text', 'mine'],
  ['patch-text', 'patch'],
  ['key-text', 'key'],
  ['key-dark-text', 'key-dark'],
  ['brass-text', 'brass'],
  ['tape-text', 'tape'],
];
