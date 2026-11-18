/**
 * parse(text, jack): a visitor's text to an Instruction for the station on
 * the line, or a Refusal. Pure and deterministic; no sentence is written
 * here (replies are ids, see types.ts).
 *
 * The grammar, in short:
 * 1. A text over MAX_TEXT characters, or not a string, is for Taylor.
 * 2. Quoted spans ("…", '…', “…”) are set aside whole, then the text is cut
 *    into clauses at , ; new lines, sentence ends, and "and", "then",
 *    "also", "plus", "&", "+".
 * 3. Each clause, manners stripped ("please", "can you", "hey Patch"), is
 *    read as the first of:
 *    a. words for tape: "call it X", "label: X", "label the crate X",
 *       "make the sign say X", "the sign should read X", "change the sign
 *       to X" (unless X is a colour), "write X on the crate", "say X". The
 *       words run to the end of the text unless a later clause is itself a
 *       command, so "call it SALT AND PEPPER" is one label;
 *    b. greeting or "help" → help; "who are you" and kin → who; "thanks",
 *       "nice" → thanks; "undo that", "take it back", "oops" → undo;
 *    c. a negation ("don't…", "not…") → for Taylor;
 *    d. features: colours (the eight paints and synonyms, shades dropped,
 *       coloured emoji), a picture for the window, open or closed, the
 *       belt's verbs, the lamp's verbs. Strong words ("faster", "reverse",
 *       "brighter", "closed", a colour) count anywhere; weak ones ("go",
 *       "on", "off", "up", "down", "dark") count only beside a noun of their
 *       jack or in a clause made only of words Patch knows ("turn it off"
 *       yes, "go away" no).
 * 4. Each feature goes to a jack: the nearest noun in the clause decides
 *    ("paint the crate blue" is the platen's, "the lamp's off" the lamp's);
 *    with no noun, the jack the cord is in, if that jack does it at all.
 * 5. The changes for this jack become one Instruction (the last value for a
 *    field wins). A change for another jack adds "That's outside this
 *    folder"; alone, it is the refusal. Words that break the tape rule
 *    refuse the whole text. Nothing usable at all → the mailbox.
 */
import { checkWords } from './tape.ts';
import type { TapeResult } from './tape.ts';
import type {
  BeltArgs,
  Colour,
  Instruction,
  Jack,
  LampArgs,
  LampColour,
  NoArgs,
  Parsed,
  PictureArg,
  PlatenArgs,
  Refusal,
  ReplyLine,
  StorefrontArgs,
} from './types.ts';
import {
  AMBER,
  AWNING_NOUNS,
  BACKWARD,
  BELT_NOUNS,
  BRIGHTER,
  CLOSED,
  COLOUR_EMOJI,
  COLOUR_WORDS,
  DIMMER,
  DOWN,
  FASTER,
  FILLER,
  FLIP,
  FORWARD,
  GO,
  LAMP_NOUNS,
  NEGATIONS,
  OFF,
  ON,
  OPEN,
  OTHER_COLOURS,
  PHRASES,
  PICTURE_NOUNS,
  PICTURE_WORDS,
  PLATEN_NOUNS,
  REVERSE,
  SHADES,
  SIGN_NOUNS,
  SLOWER,
  STOP,
  UP,
  WARM_WORDS,
  nounJack,
} from './words.ts';

/** Longer than this is not a text to a switchboard: it goes to Taylor unread. */
export const MAX_TEXT = 240;

// ───────────────────────── pieces a clause can yield ─────────────────────────

type Field =
  | { jack: 'storefront'; key: 'sign' | 'awning'; value: Colour }
  | { jack: 'storefront'; key: 'words'; value: string }
  | { jack: 'storefront'; key: 'open'; value: boolean }
  | { jack: 'storefront'; key: 'picture'; value: PictureArg }
  | { jack: 'platen'; key: 'colour'; value: Colour }
  | { jack: 'platen'; key: 'label'; value: string }
  | { jack: 'belt'; key: 'speed'; value: 1 | -1 }
  | { jack: 'belt'; key: 'running'; value: boolean }
  | { jack: 'belt'; key: 'direction'; value: 'forward' | 'backward' | 'flip' }
  | { jack: 'lamp'; key: 'level'; value: 1 | -1 }
  | { jack: 'lamp'; key: 'on'; value: boolean }
  | { jack: 'lamp'; key: 'colour'; value: LampColour };

type Meta = 'undo' | 'help' | 'who' | 'thanks';

type Piece =
  | { t: 'change'; field: Field }
  | { t: 'words'; jack: 'storefront' | 'platen'; raw: string }
  | { t: 'meta'; verb: Meta }
  | { t: 'cannot' }
  | { t: 'colour-unknown' }
  | { t: 'picture-unknown' }
  | { t: 'unparsed'; words: number };

// ───────────────────────── text handling ─────────────────────────

/** Lower case, accents dropped, apostrophes out, everything but letters, digits and ? to spaces. */
function fold(s: string): string {
  let out = s.normalize('NFKC');
  for (const [emoji, word] of Object.entries(COLOUR_EMOJI)) out = out.split(emoji).join(` ${word} `);
  return out
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}?]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const POLITE_HEAD =
  /^(?:(?:please|pls|plz|kindly|hey|hi|hello|yo|ok|okay|so|now|just|patch|can you|could you|would you|will you|can u|could u|i want you to|i'd like you to|i would like you to|go ahead and|let's|lets)\b[\s,:!.]*)+/i;
const POLITE_TAIL = /(?:[\s,]+\b(?:please|pls|plz|thanks|thank you|thx|ty|asap))+[\s.!?]*$/i;

/** Manners off the end of a label ("call it FRAGILE please"); the head is left alone (HELLO is a fine sign). */
function stripTail(raw: string): string {
  return raw.replace(/(?:[\s,]+\b(?:please|pls|plz|thanks|thank you|thx|ty))+[\s.!?]*$/i, '').trim();
}

function stripManners(raw: string): string {
  return raw.replace(POLITE_HEAD, '').replace(POLITE_TAIL, '').trim();
}

interface Clause {
  /** Separator text that came before it (kept so words can run on across it). */
  sep: string;
  raw: string;
}

const QUOTE = /"([^"]*)"|“([^”]*)”|'([^']*)'(?![a-z])|‘([^’]*)’/g;
const MARK = (i: number): string => `qqmark${i}qq`;

function splitClauses(text: string): { clauses: Clause[]; quotes: string[] } {
  const quotes: string[] = [];
  const marked = text.replace(QUOTE, (m: string, a?: string, b?: string, c?: string, d?: string, offset?: number, whole?: string) => {
    // An apostrophe inside a word ("it's") is not a quote.
    if (m.startsWith("'") && typeof offset === 'number' && whole && /[A-Za-z]/.test(whole[offset - 1] ?? '')) return m;
    quotes.push(a ?? b ?? c ?? d ?? '');
    return MARK(quotes.length - 1);
  });
  const clauses: Clause[] = [];
  const re = /\s*(?:[,;\n]+|[.!?]+(?=\s|$)|\s(?:and|then|also|plus|&|\+)(?=\s))\s*/gi;
  let last = 0;
  let sep = '';
  for (let m = re.exec(marked); m; m = re.exec(marked)) {
    clauses.push({ sep, raw: marked.slice(last, m.index) });
    sep = m[0];
    last = m.index + m[0].length;
  }
  clauses.push({ sep, raw: marked.slice(last) });
  return { clauses: clauses.filter((c) => c.raw.trim() !== ''), quotes };
}

const unmark = (s: string, quotes: readonly string[]): string => s.replace(/qqmark(\d+)qq/g, (_m, i: string) => `"${quotes[Number(i)] ?? ''}"`);

// ───────────────────────── words for tape ─────────────────────────

const TARGET_STORE = new Set(['sign', 'shop', 'store', 'storefront']);
const TARGET_PLATEN = new Set(['label', 'tape', 'tag', 'sticker', 'crate', 'box', 'robot', 'fetch', 'tray', 'part']);

function wordsTarget(noun: string | undefined, jack: Jack, sayOnly = false): 'storefront' | 'platen' | null {
  const n = (noun ?? '').toLowerCase().replace(/^(?:the|my|this|that)\s+/, '');
  if (TARGET_STORE.has(n)) return 'storefront';
  if (TARGET_PLATEN.has(n)) return 'platen';
  if (jack === 'storefront') return 'storefront';
  if (jack === 'platen') return 'platen';
  return sayOnly ? null : 'platen';
}

const OBJ = String.raw`(?:the\s+|my\s+|this\s+|that\s+)?`;
const SAY = String.raw`(?:say|says|read|reads|spell|spells|show|shows|display|to\s+say|to\s+read)`;

/** If the clause asks for words on tape or the sign, the target and the raw words. */
function wordsRequest(s: string, jack: Jack): { jack: 'storefront' | 'platen'; raw: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /^(label|tag|sticker|tape|sign|name|title|words?|text|write|say)\s*[:=]\s*(.+)$/i.exec(s))) {
    const target = wordsTarget(m[1], jack);
    return target && { jack: target, raw: m[2]! };
  }
  if ((m = new RegExp(String.raw`^(?:make|have|let|get)\s+${OBJ}(sign|shop|store|storefront|it|this|that|label|tape|tag|crate|box|robot|fetch)\s+${SAY}\s+(.+)$`, 'i').exec(s))) {
    const target = wordsTarget(m[1], jack);
    return target && { jack: target, raw: m[2]! };
  }
  if ((m = new RegExp(String.raw`^${OBJ}(sign|label|tag|tape)\s+(?:should\s+|will\s+|can\s+|must\s+)?${SAY}\s+(.+)$`, 'i').exec(s))) {
    const target = wordsTarget(m[1], jack);
    return target && { jack: target, raw: m[2]! };
  }
  if ((m = new RegExp(String.raw`^(?:change|set|rename|switch|update|turn)\s+${OBJ}(sign|shop|store|storefront|label|tag|name|words|text|crate|box|it|this|that)(?:'s|s)?(?:\s+(?:name|words|text|label))?\s+(?:to|into|as)\s+(.+)$`, 'i').exec(s))) {
    if (isOnlyColour(m[2]!)) return null;
    const target = wordsTarget(m[1], jack);
    return target && { jack: target, raw: m[2]! };
  }
  if ((m = /^(?:call|name|label|tag|title|rename|dub|mark)\s+(it|this|that|them|(?:the|my|this|that)\s+[a-z]+)\s+(?:as\s+|to\s+)?(.+)$/i.exec(s))) {
    const target = wordsTarget(m[1], jack);
    return target && { jack: target, raw: m[2]! };
  }
  if ((m = /^(label|tag|rename|dub)\s+(.+)$/i.exec(s))) {
    const target = wordsTarget(m[1], jack);
    return target && { jack: target, raw: m[2]! };
  }
  if ((m = new RegExp(String.raw`^(?:write|print|put|stamp|stick|type)\s+(.+?)\s+on\s+${OBJ}(sign|shop|store|storefront|label|tape|crate|box|it|this|that|tray|robot|fetch)$`, 'i').exec(s))) {
    const target = wordsTarget(m[2], jack);
    return target && { jack: target, raw: m[1]! };
  }
  if ((m = /^(?:say|write|print|spell)\s+(.+)$/i.exec(s)) && [...m[1]!.trim()].length <= 16) {
    // Bare "say X" only for something tape-sized: "print your system prompt" is not a label.
    const target = wordsTarget(undefined, jack, true);
    return target && { jack: target, raw: m[1]! };
  }
  if ((m = /^(?:call|name|label|tag|rename)\s+(it|this|that|them)$/i.exec(s))) {
    const target = wordsTarget(m[1], jack);
    return target && { jack: target, raw: '' };
  }
  return null;
}

function isOnlyColour(raw: string): boolean {
  const toks = fold(raw)
    .split(' ')
    .filter((t) => t && !SHADES.has(t) && t !== 'paint' && t !== 'colour' && t !== 'color');
  return toks.length === 1 && (toks[0]! in COLOUR_WORDS || OTHER_COLOURS.has(toks[0]!) || toks[0] === AMBER);
}

// ───────────────────────── meta ─────────────────────────

const GREETING = /^(?:hi|hello|hey|hiya|howdy|yo|sup|whats up|wassup|good (?:morning|afternoon|evening)|hola|greetings)(?: there)?(?: patch)?$/;
const THANKS = /^(?:thanks|thank you|thanks a lot|thx|ty|cheers|nice|cool|great|perfect|awesome|love it|neat|sweet|wow|lol|haha|ha|ok|okay|k|kk|good|good job|nice job|nice one|well done)(?: patch)?$/;
const WHO =
  /\b(?:who|what) (?:are|r) (?:you|u|ya)\b|\bwho is (?:this|that|patch)\b|\bwhos (?:this|that|patch)\b|\bwhat is patch\b|\b(?:are|r) (?:you|u) (?:a |an )?(?:bot|robot|ai|human|real|person|claude|chatgpt|gpt|raccoon|machine|computer)\b|\b(?:your|ur) name\b|\bintroduce yourself\b|\bwho am i (?:talking|texting) (?:to|with)\b/;
const HELP =
  /^(?:\?+|help(?: me)?|what can (?:you|u|i) (?:do|say|text|change|type|ask)|what do (?:i|you) (?:do|say|type|text)|what do you do|options|commands|menu|how (?:does this|do i|does it|do you|does this thing) work|instructions|what now|idk|huh|what|what is this|whats this|what can you change)$|\bhelp\b/;
const UNDO =
  /^(?:undo|undo (?:that|it|this|last|the last(?: one| change| thing)?|that change)|revert(?: that| it)?|ctrl ?z|cmd ?z|control z|oops|whoops|nevermind|never mind|nvm|scratch that|take (?:it|that) back|put (?:it|that) back|change (?:it|that) back|go back|back|cancel(?: that)?|restore(?: it)?|undo undo)$/;

function metaOf(whole: string, stripped: string): Meta | null {
  if (GREETING.test(whole)) return 'help';
  if (THANKS.test(whole) || THANKS.test(stripped)) return 'thanks';
  if (WHO.test(whole)) return 'who';
  if (UNDO.test(stripped)) return 'undo';
  if (HELP.test(stripped) || HELP.test(whole)) return 'help';
  return null;
}

// ───────────────────────── features ─────────────────────────

const CLEAR_WORDS: ReadonlySet<string> = new Set(['remove', 'clear', 'empty', 'none', 'nothing', 'blank']);

const KNOWN = new Set<string>([
  ...FILLER, ...GO, ...ON, ...OFF, ...UP, ...DOWN, ...FLIP, ...FASTER, ...SLOWER, ...STOP, ...REVERSE, ...BACKWARD, ...FORWARD,
  ...BRIGHTER, ...DIMMER, ...OPEN, ...CLOSED, ...SIGN_NOUNS, ...AWNING_NOUNS, ...PICTURE_NOUNS, ...PLATEN_NOUNS, ...BELT_NOUNS,
  ...LAMP_NOUNS, ...WARM_WORDS, ...Object.keys(COLOUR_WORDS), ...OTHER_COLOURS, ...Object.keys(PICTURE_WORDS),
  'speed', 'pace', 'direction', 'keep', 'get', ...CLEAR_WORDS, 'around', 'other', 'again', 'back', 'up', 'it', 'way', 'full', 'top', 'max', 'less',
]);

function features(toks: readonly string[], jack: Jack): Piece[] {
  const s = ` ${toks.join(' ')} `;
  const phrase = (list: readonly string[]): boolean => list.some((p) => s.includes(` ${p} `));
  const nouns: { i: number; jack: Jack; word: string }[] = [];
  toks.forEach((w, i) => {
    const j = nounJack(w);
    if (j) nouns.push({ i, jack: j, word: w });
  });
  const nounOf = (j: Jack): boolean => nouns.some((n) => n.jack === j);
  const allKnown = toks.every((t) => KNOWN.has(t) || /^\d+$/.test(t));
  const weakOk = (j: Jack): boolean => nounOf(j) || (allKnown && toks.filter((t) => !FILLER.has(t)).length <= 3);
  const any = (set: ReadonlySet<string>): boolean => toks.some((t) => set.has(t));
  const pieces: Piece[] = [];
  const change = (field: Field): void => {
    pieces.push({ t: 'change', field });
  };
  // Which jack an act with no noun of its own goes to.
  const soleNoun = (): Jack | null => {
    const js = [...new Set(nouns.map((n) => n.jack))];
    return js.length === 1 ? js[0]! : null;
  };

  // ── the window's picture ──
  const pictureNoun = toks.some((t) => PICTURE_NOUNS.has(t)) || (s.includes(' window ') && toks.some((t) => t in PICTURE_WORDS));
  const subject = toks.find((t) => t in PICTURE_WORDS);
  const bareSubject = !pictureNoun && subject !== undefined && jack === 'storefront' && toks.every((t) => FILLER.has(t) || t === subject || t === 'window');
  const clearing = phrase(PHRASES.pictureNone) || ((pictureNoun || s.includes(' window ')) && (any(CLEAR_WORDS) || (s.includes(' take ') && s.includes(' down '))));
  if (clearing && (pictureNoun || s.includes(' window ') || s.includes(' take '))) {
    change({ jack: 'storefront', key: 'picture', value: 'none' });
    return pieces;
  }
  if (pictureNoun || bareSubject) {
    if (subject) change({ jack: 'storefront', key: 'picture', value: PICTURE_WORDS[subject]! });
    else if (s.includes(' of ')) pieces.push({ t: 'picture-unknown' });
    else change({ jack: 'storefront', key: 'picture', value: 'next' });
    return pieces;
  }

  // ── colours ──
  toks.forEach((w, i) => {
    const isColour = w in COLOUR_WORDS || OTHER_COLOURS.has(w) || w === AMBER;
    const lampWarm = WARM_WORDS.has(w) && (nounOf('lamp') || (jack === 'lamp' && nouns.length === 0));
    if (!isColour && !lampWarm) return;
    // The nearest noun decides; a tie goes to the later one ("red sign" and "sign red" both find the sign).
    let best: { i: number; jack: Jack; word: string } | null = null;
    for (const n of nouns) if (!best || Math.abs(n.i - i) <= Math.abs(best.i - i)) best = n;
    const target: Jack | null = best ? best.jack : jack === 'belt' ? null : jack;
    if (target === null || target === 'belt') {
      pieces.push({ t: 'cannot' });
      return;
    }
    if (target === 'lamp' && (lampWarm || w === AMBER)) {
      change({ jack: 'lamp', key: 'colour', value: 'warm' });
      return;
    }
    if (lampWarm) return;
    if (OTHER_COLOURS.has(w)) {
      pieces.push({ t: 'colour-unknown' });
      return;
    }
    const colour: Colour = w === AMBER ? 'paint-orange' : COLOUR_WORDS[w]!;
    if (target === 'storefront') change({ jack: 'storefront', key: best && AWNING_NOUNS.has(best.word) ? 'awning' : 'sign', value: colour });
    else if (target === 'platen') change({ jack: 'platen', key: 'colour', value: colour });
    else change({ jack: 'lamp', key: 'colour', value: colour });
  });

  // ── open or closed ──
  const lidNoun = toks.some((t) => PLATEN_NOUNS.has(t) || t === 'lid' || t === 'drawer' || t === 'hatch' || t === 'latch');
  if (!lidNoun) {
    if (phrase(PHRASES.closed)) change({ jack: 'storefront', key: 'open', value: false });
    else {
      let last: boolean | null = null;
      for (const t of toks) {
        if (OPEN.has(t)) last = true;
        else if (CLOSED.has(t)) last = false;
      }
      if (last !== null) change({ jack: 'storefront', key: 'open', value: last });
    }
  }

  // ── the belt ──
  const beltNoun = nounOf('belt');
  if (any(FASTER) || phrase(PHRASES.faster)) change({ jack: 'belt', key: 'speed', value: 1 });
  else if (any(SLOWER) || phrase(PHRASES.slower)) change({ jack: 'belt', key: 'speed', value: -1 });
  if (any(STOP)) change({ jack: 'belt', key: 'running', value: false });
  if (any(REVERSE) || phrase(PHRASES.flip)) change({ jack: 'belt', key: 'direction', value: 'flip' });
  else if (any(BACKWARD)) change({ jack: 'belt', key: 'direction', value: 'backward' });
  else if (any(FORWARD) && (beltNoun || weakOk('belt'))) change({ jack: 'belt', key: 'direction', value: 'forward' });
  else if (any(FLIP) && (beltNoun || (jack === 'belt' && weakOk('belt')))) change({ jack: 'belt', key: 'direction', value: 'flip' });
  const beltSpoken = pieces.some((p) => p.t === 'change' && p.field.jack === 'belt');
  if (!beltSpoken && (any(GO) || phrase(PHRASES.go)) && !any(STOP) && (beltNoun || (weakOk('belt') && (jack === 'belt' || soleNoun() === null)))) {
    if (!(nounOf('lamp') && phrase(PHRASES.go))) change({ jack: 'belt', key: 'running', value: true });
  }

  // ── the lamp ──
  const lampNoun = nounOf('lamp');
  if (any(BRIGHTER) || (lampNoun && phrase(PHRASES.brighter))) change({ jack: 'lamp', key: 'level', value: 1 });
  else if (any(DIMMER) || (lampNoun && phrase(PHRASES.dimmer))) change({ jack: 'lamp', key: 'level', value: -1 });

  // ── weak words: on, off, up, down; they go to the noun's jack, else the cord's ──
  const weakJack: Jack | null = soleNoun() ?? (nouns.length === 0 ? jack : null);
  const said = (j: Jack, key: string): boolean => pieces.some((p) => p.t === 'change' && p.field.jack === j && p.field.key === key);
  const offWord = any(OFF) || phrase(PHRASES.off);
  const onWord = (any(ON) || phrase(PHRASES.on)) && !offWord;
  const upWord = any(UP) || phrase(PHRASES.brighter);
  const downWord = any(DOWN) || phrase(PHRASES.dimmer);
  if (weakJack && (offWord || onWord) && weakOk(weakJack)) {
    if (weakJack === 'lamp' && !said('lamp', 'on')) change({ jack: 'lamp', key: 'on', value: onWord });
    else if (weakJack === 'belt' && !said('belt', 'running')) {
      // "off" stops it; "on" starts it. "dark" and "night" are the lamp's.
      if (onWord || toks.some((t) => t === 'off' || t === 'out')) change({ jack: 'belt', key: 'running', value: onWord });
    } else if (weakJack === 'storefront' || weakJack === 'platen') {
      if (pieces.length === 0) pieces.push({ t: 'cannot' });
    }
  }
  const speedSaid = pieces.some((p) => p.t === 'change' && (p.field.key === 'speed' || p.field.key === 'level'));
  if (weakJack && !speedSaid && (upWord || downWord) && !(upWord && downWord) && weakOk(weakJack)) {
    if (weakJack === 'lamp' && !said('lamp', 'level')) change({ jack: 'lamp', key: 'level', value: upWord ? 1 : -1 });
    else if (weakJack === 'belt' && !said('belt', 'speed')) change({ jack: 'belt', key: 'speed', value: upWord ? 1 : -1 });
  }

  // Only a noun of this jack ("the awning?"): say what can be done with it here.
  if (pieces.length === 0 && nouns.length > 0 && nouns.every((n) => n.jack === jack) && toks.every((t) => FILLER.has(t) || nounJack(t) !== null)) {
    pieces.push({ t: 'meta', verb: 'help' });
  }
  return pieces;
}

function interpret(clause: string, jack: Jack, quotes: readonly string[]): Piece[] {
  const stripped = stripManners(clause);
  const words = wordsRequest(unmark(stripped, quotes).replace(/[.!?]+$/, '').trim(), jack);
  if (words) return [{ t: 'words', jack: words.jack, raw: words.raw }];
  const whole = fold(unmark(clause, quotes));
  const bare = fold(unmark(stripped, quotes));
  if (whole === '' && bare === '') return [];
  const meta = metaOf(whole, bare);
  if (meta) return [{ t: 'meta', verb: meta }];
  const toks = bare
    .replace(/\?/g, ' ')
    .split(' ')
    .filter(Boolean);
  // Shades only colour a colour: "light blue" is blue, not the lamp.
  const kept = toks.filter((t, i) => !(SHADES.has(t) && i + 1 < toks.length && (toks[i + 1]! in COLOUR_WORDS || OTHER_COLOURS.has(toks[i + 1]!))));
  if (kept.length === 0) return [];
  const meaningful = kept.filter((t) => !FILLER.has(t)).length;
  const spaced = ` ${kept.join(' ')} `;
  const exempt = [...PHRASES.pictureNone, ...PHRASES.closed].some((p) => spaced.includes(` ${p} `));
  if (kept.some((t) => NEGATIONS.has(t)) && !exempt) return [{ t: 'unparsed', words: meaningful }];
  const found = features(kept, jack);
  if (found.length > 0) return found;
  return meaningful === 0 ? [] : [{ t: 'unparsed', words: meaningful }];
}

// ───────────────────────── the result ─────────────────────────

const refusal = (jack: Jack, reason: Refusal['reason'], reply: readonly ReplyLine[], extra: { wanted?: Jack } = {}): Refusal => ({
  kind: 'refusal',
  jack,
  reason,
  reply,
  mailbox: reason === 'mailbox',
  ...extra,
});

const mailbox = (jack: Jack): Refusal => refusal(jack, 'mailbox', [{ id: 'mailbox' }]);

function wordsRefusal(jack: Jack, res: Exclude<TapeResult, { ok: true }>): Refusal {
  switch (res.reason) {
    case 'empty':
      return refusal(jack, 'words-empty', [{ id: 'words.empty' }]);
    case 'blocked':
      return refusal(jack, 'words-blocked', [{ id: 'words.blocked' }]);
    case 'glyphs':
      return refusal(jack, 'words-glyphs', [{ id: 'words.glyphs' }]);
    case 'long':
      return refusal(jack, 'words-long', [{ id: 'words.long', count: res.count ?? 0 }]);
  }
}

const meta = (jack: Jack, verb: Meta): Instruction => {
  const args: NoArgs = {};
  const base = { kind: 'instruction' as const, jack, args, mailbox: false };
  switch (verb) {
    case 'undo':
      return { ...base, verb, reply: UNDO_REPLIES.done };
    case 'help':
      return { ...base, verb, reply: [{ id: `help.${jack}` }, { id: 'help.undo' }] };
    case 'who':
      return { ...base, verb, reply: [{ id: 'who' }] };
    case 'thanks':
      return { ...base, verb, reply: [{ id: 'thanks' }] };
  }
};

/** What the station texts back for "undo that", by what the history did (§ E5). */
export const UNDO_REPLIES = {
  /** It was put back. */
  done: [{ id: 'undo.done' }, { id: 'done.checked' }],
  /** Nothing made by text is left to take back. */
  nothing: [{ id: 'undo.nothing' }],
  /** The last text's change has been written over since (the dial was turned): left alone, still on the stack. */
  blocked: [{ id: 'undo.blocked' }],
} as const satisfies Record<string, readonly ReplyLine[]>;

const DONE: readonly ReplyLine[] = [{ id: 'done.checked' }, { id: 'done.patched' }];

function build(jack: Jack, fields: readonly Field[]): { verb: Instruction['verb']; args: Instruction['args']; lines: ReplyLine[] } {
  const last = <K extends string>(key: K): Field | undefined => [...fields].reverse().find((f) => f.key === key);
  const lines: ReplyLine[] = [];
  switch (jack) {
    case 'storefront': {
      const args: { -readonly [K in keyof StorefrontArgs]: StorefrontArgs[K] } = {};
      const sign = last('sign');
      const words = last('words');
      const awning = last('awning');
      const open = last('open');
      const picture = last('picture');
      if (sign?.key === 'sign') {
        args.sign = sign.value;
        lines.push({ id: 'change.sign', colour: sign.value });
      }
      if (words?.key === 'words') {
        args.words = words.value;
        lines.push({ id: 'change.words', words: words.value });
      }
      if (awning?.key === 'awning') {
        args.awning = awning.value;
        lines.push({ id: 'change.awning', colour: awning.value });
      }
      if (open?.key === 'open') {
        args.open = open.value;
        lines.push({ id: open.value ? 'change.open' : 'change.closed' });
      }
      if (picture?.key === 'picture') {
        args.picture = picture.value;
        if (picture.value === 'none') lines.push({ id: 'change.picture.none' });
        else if (picture.value === 'next') lines.push({ id: 'change.picture.next' });
        else lines.push({ id: 'change.picture', picture: picture.value });
      }
      return { verb: 'storefront.set', args, lines };
    }
    case 'platen': {
      const args: { -readonly [K in keyof PlatenArgs]: PlatenArgs[K] } = {};
      const colour = fields.filter((f) => f.jack === 'platen' && f.key === 'colour').at(-1);
      const label = last('label');
      if (colour?.key === 'colour' && colour.jack === 'platen') {
        args.colour = colour.value;
        lines.push({ id: 'change.platen.colour', colour: colour.value });
      }
      if (label?.key === 'label') {
        args.label = label.value;
        lines.push({ id: 'change.platen.label', words: label.value });
      }
      return { verb: 'platen.set', args, lines };
    }
    case 'belt': {
      const args: { -readonly [K in keyof BeltArgs]: BeltArgs[K] } = {};
      const running = last('running');
      const direction = last('direction');
      const speed = last('speed');
      if (running?.key === 'running') {
        args.running = running.value;
        lines.push({ id: running.value ? 'change.belt.go' : 'change.belt.stop' });
      }
      if (direction?.key === 'direction') {
        args.direction = direction.value;
        lines.push({ id: direction.value === 'flip' ? 'change.belt.flip' : direction.value === 'forward' ? 'change.belt.forward' : 'change.belt.backward' });
      }
      if (speed?.key === 'speed') {
        args.speed = speed.value;
        lines.push({ id: speed.value === 1 ? 'change.belt.faster' : 'change.belt.slower' });
      }
      return { verb: 'belt.set', args, lines };
    }
    case 'lamp': {
      const args: { -readonly [K in keyof LampArgs]: LampArgs[K] } = {};
      const on = last('on');
      const colour = fields.filter((f) => f.jack === 'lamp' && f.key === 'colour').at(-1);
      const level = last('level');
      if (on?.key === 'on') {
        args.on = on.value;
        lines.push({ id: on.value ? 'change.lamp.on' : 'change.lamp.off' });
      }
      if (colour?.jack === 'lamp' && colour.key === 'colour') {
        args.colour = colour.value;
        lines.push(colour.value === 'warm' ? { id: 'change.lamp.warm' } : { id: 'change.lamp.colour', colour: colour.value });
      }
      if (level?.key === 'level') {
        args.level = level.value;
        lines.push({ id: level.value === 1 ? 'change.lamp.brighter' : 'change.lamp.dimmer' });
      }
      return { verb: 'lamp.set', args, lines };
    }
  }
}

/**
 * Read a text sent down the cord into `jack`. Pure: the same text and jack
 * always give the same answer.
 */
export function parse(text: unknown, jack: Jack): Parsed {
  if (typeof text !== 'string') return mailbox(jack);
  const trimmed = text.trim();
  if (trimmed === '' || [...trimmed].length > MAX_TEXT) return mailbox(jack);
  if (/^\?+$/.test(trimmed)) return meta(jack, 'help');

  const { clauses, quotes } = splitClauses(trimmed);
  const pieces: Piece[] = [];
  for (let i = 0; i < clauses.length; i++) {
    const got = interpret(clauses[i]!.raw, jack, quotes);
    const w = got[0];
    if (w?.t === 'words') {
      // The words run on across separators until a clause that is itself a command.
      let raw = unmark(w.raw, quotes);
      while (i + 1 < clauses.length) {
        const next = interpret(clauses[i + 1]!.raw, jack, quotes);
        if (next.length > 0 && next.every((p) => p.t === 'unparsed')) {
          raw += clauses[i + 1]!.sep + unmark(clauses[i + 1]!.raw, quotes);
          i++;
        } else break;
      }
      const res = checkWords(stripTail(raw));
      if (!res.ok) return wordsRefusal(jack, res);
      pieces.push({ t: 'change', field: w.jack === 'storefront' ? { jack: 'storefront', key: 'words', value: res.text } : { jack: 'platen', key: 'label', value: res.text } });
      continue;
    }
    pieces.push(...got);
  }

  const changes = pieces.flatMap((p) => (p.t === 'change' ? [p.field] : []));
  const here = changes.filter((f) => f.jack === jack);
  const away = changes.filter((f) => f.jack !== jack);
  const leftover = pieces.some((p) => p.t === 'unparsed' && p.words >= 2);
  const colourUnknown = pieces.some((p) => p.t === 'colour-unknown');
  const pictureUnknown = pieces.some((p) => p.t === 'picture-unknown');

  if (here.length > 0) {
    const { verb, args, lines } = build(jack, here);
    const reply: ReplyLine[] = [...lines, ...DONE];
    if (colourUnknown) reply.push({ id: 'colour.unknown' });
    if (pictureUnknown) reply.push({ id: 'picture.unknown' });
    if (away.length > 0) reply.push({ id: 'outside' });
    if (leftover) reply.push({ id: 'mailbox' });
    return { kind: 'instruction', jack, verb, args, reply, mailbox: leftover } as Instruction;
  }
  if (colourUnknown) return refusal(jack, 'colour-unknown', [{ id: 'colour.unknown' }]);
  if (pictureUnknown && (jack === 'storefront' || away.length === 0)) {
    return jack === 'storefront' ? refusal(jack, 'picture-unknown', [{ id: 'picture.unknown' }]) : refusal(jack, 'outside', [{ id: 'outside' }], { wanted: 'storefront' });
  }
  if (away.length > 0) return refusal(jack, 'outside', [{ id: 'outside' }], { wanted: away[0]!.jack });
  const m = pieces.find((p) => p.t === 'meta');
  if (m?.t === 'meta') return meta(jack, m.verb);
  if (pieces.some((p) => p.t === 'cannot')) return refusal(jack, 'not-here', [{ id: 'not-here' }, { id: `help.${jack}` }]);
  return mailbox(jack);
}
