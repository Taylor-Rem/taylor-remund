/**
 * The vocabulary: which typed words mean what. Input words only; nothing
 * here is shown to a visitor (what Patch says lives in src/content/texts.json).
 * Every word is lower case, accents dropped, as `fold` in parse.ts leaves it.
 */
import type { Colour, Jack, Picture } from './types.ts';

const set = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));

/** The eight paints by palette token, in the order the palette lists them (view/palette.ts `paints`). */
export const PAINTS: readonly Colour[] = ['cable-red', 'paint-orange', 'tape-yellow', 'paint-green', 'teal-light', 'paint-blue', 'paint-violet', 'paper'];

/** Plain names and obvious synonyms for each paint. */
export const COLOUR_WORDS: Readonly<Record<string, Colour>> = (() => {
  const out: Record<string, Colour> = {};
  const add = (token: Colour, words: string): void => {
    for (const w of set(words)) out[w] = token;
  };
  add('cable-red', 'red reds crimson scarlet cherry maroon burgundy ruby brick');
  add('paint-orange', 'orange tangerine pumpkin');
  add('tape-yellow', 'yellow gold golden mustard lemon canary');
  add('paint-green', 'green lime olive emerald mint sage');
  add('teal-light', 'teal turquoise aqua cyan seafoam');
  add('paint-blue', 'blue navy cobalt azure sapphire');
  add('paint-violet', 'violet purple lavender lilac plum indigo mauve');
  add('paper', 'cream white ivory beige paper eggshell');
  return out;
})();

/** Colours that are not one of the eight: the reply lists the eight. */
export const OTHER_COLOURS = set('pink magenta fuchsia rose black brown grey gray silver tan khaki bronze copper rainbow clear transparent invisible chartreuse');

/** "amber" is orange on paint, but the lamp's own light on the lamp. */
export const AMBER = 'amber';
/** The lamp's own warm light (lamp only). */
export const WARM_WORDS = set('warm normal default amber original regular usual');

/** Words that only shade a colour ("light blue", "dark green"): dropped before a colour word. */
export const SHADES = set('light dark pale bright deep hot sky baby royal forest neon pastel dusty bright');

/** Coloured emoji read as their colour word. */
export const COLOUR_EMOJI: Readonly<Record<string, string>> = {
  '🔴': 'red', '❤': 'red', '🟥': 'red',
  '🟠': 'orange', '🧡': 'orange', '🟧': 'orange',
  '🟡': 'yellow', '💛': 'yellow', '🟨': 'yellow',
  '🟢': 'green', '💚': 'green', '🟩': 'green',
  '🔵': 'blue', '💙': 'blue', '🟦': 'blue',
  '🟣': 'violet', '💜': 'violet', '🟪': 'violet',
  '⚪': 'white', '🤍': 'white', '⬜': 'white',
};

/** The window's pictures and the words for each. PROVISIONAL: the set follows the storefront's. */
export const PICTURES: readonly Picture[] = ['mountains', 'sun', 'boat', 'tree', 'house'];
export const PICTURE_WORDS: Readonly<Record<string, Picture>> = (() => {
  const out: Record<string, Picture> = {};
  const add = (p: Picture, words: string): void => {
    for (const w of set(words)) out[w] = p;
  };
  add('mountains', 'mountain mountains hill hills peak peaks alps range');
  add('sun', 'sun sunny sunshine sunset sunrise');
  add('boat', 'boat boats ship ships sailboat sail yacht');
  add('tree', 'tree trees forest pine oak');
  add('house', 'house houses home cabin cottage');
  return out;
})();

// ── nouns: what a text is about ──

export const SIGN_NOUNS = set('sign signs signboard fascia shop store storefront shopfront window door front');
export const AWNING_NOUNS = set('awning awnings canopy stripes');
export const PICTURE_NOUNS = set('picture pictures photo photos pic pics image painting poster drawing frame photograph');
export const PLATEN_NOUNS = set('crate crates box boxes tray platen part parts robot robots bot fetch revert label labels tag tape sticker tool tools wrench thing package parcel item');
export const BELT_NOUNS = set('belt belts conveyor conveyer rollers');
export const LAMP_NOUNS = set('lamp lamps light lights bulb lighting brightness room workshop');

/** The jack a noun belongs to, or null. */
export function nounJack(word: string): Jack | null {
  if (SIGN_NOUNS.has(word) || AWNING_NOUNS.has(word) || PICTURE_NOUNS.has(word)) return 'storefront';
  if (PLATEN_NOUNS.has(word)) return 'platen';
  if (BELT_NOUNS.has(word)) return 'belt';
  if (LAMP_NOUNS.has(word)) return 'lamp';
  return null;
}

// ── verbs ──

/** Strong words count wherever they appear in a clause. */
export const FASTER = set('faster quicker hurry accelerate turbo zoom speedier');
export const SLOWER = set('slower decelerate');
export const STOP = set('stop stopped halt pause paused freeze');
export const REVERSE = set('reverse reversed');
export const BACKWARD = set('backwards backward');
export const FORWARD = set('forwards forward');
export const BRIGHTER = set('brighter brighten');
export const DIMMER = set('dimmer dim darker');
export const OPEN = set('open opened reopen');
export const CLOSED = set('closed close shut closing');

/** Weak words count only in a short clause of known words, or beside a noun of their jack. */
export const GO = set('go start run resume unpause play move continue going running started');
export const ON = set('on');
export const OFF = set('off out dark night blackout');
export const UP = set('up higher increase more bright lighter max fast crank');
export const DOWN = set('down lower decrease less low slow softer');
export const FLIP = set('flip rewind');

/** Phrases (matched on the clause with single spaces). */
export const PHRASES = {
  faster: ['speed up', 'speed it up', 'go fast', 'full speed', 'max speed', 'top speed', 'step on it', 'pick up the pace', 'more speed'],
  slower: ['slow down', 'slow it down', 'ease up', 'ease off', 'calm down', 'less speed', 'chill out'],
  flip: ['other way', 'turn around', 'switch direction', 'change direction', 'go back the other way', 'wrong way'],
  brighter: ['more light', 'turn up', 'turn it up', 'lights up'],
  dimmer: ['less light', 'turn down', 'turn it down', 'tone it down'],
  go: ['keep going', 'get going', 'start up', 'start it up', 'turn on'],
  off: ['lights out', 'turn off', 'shut off', 'switch off', 'kill the lights', 'kill the light', 'kill the lamp', 'lights off'],
  on: ['lights on', 'switch on'],
  closed: ['close up', 'shut up shop', 'not open'],
  pictureNone: ['no picture', 'no photo', 'take down', 'take it down', 'empty window', 'empty the window', 'clear the window', 'remove the picture', 'remove the photo', 'nothing in the window'],
} as const;

/** Words that carry no meaning of their own here (manners, articles, carrier verbs). */
export const FILLER = set(
  'please pls plz plez kindly thanks thank thx ty patch hey hi hello yo ok okay now just quickly asap real really very super so ' +
    'can could would will you u i id want wanna like to the a an my your our some for me us this that these those it its them ' +
    'make made turn switch set put get let change paint colour color colored coloured be is are was should all of with in into ' +
    'little bit lil tad much way again too also then and gonna wait mode',
);

/** Negations: a clause with one is for Taylor, not for a machine. */
export const NEGATIONS = set('dont not never no nope cant wont');
