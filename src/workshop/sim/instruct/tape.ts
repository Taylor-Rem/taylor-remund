/**
 * The tape rule: what a typed label or sign may be (§ B1: "label, up to 16
 * characters"; the brief: drawn in the world on Taylor's site, so nothing
 * that could embarrass him in a screenshot).
 *
 * A text's words are first normalised: Unicode compatibility forms folded,
 * accents dropped (RÉSUMÉ → RESUME), one pair of surrounding quotes and any
 * trailing full stops removed, spaces collapsed, capitals. Then, in order:
 *
 * 1. `empty`: nothing left.
 * 2. `blocked`: any of
 *    - a listed word, as a whole word: slurs, sexual words, profanity, hate
 *      words and numbers, self-harm, hard drugs, and the words that would read
 *      as a verdict on the site's owner (SCAM, FRAUD, SUCKS, HACKED…). Letters
 *      are compared after undoing look-alike digits and signs (0→O, 1→I, 3→E,
 *      4→A, 5→S, 7→T, 8→B, @→A, $→S), with stretched letters shrunk
 *      (FUUUCK) and `*` read as any letter (F*CK);
 *    - a listed root anywhere in the letters run together, for the few that
 *      never occur inside an innocent word (so F U C K and NIGGAS are caught,
 *      and SCUNTHORPE, RACCOON, SPICY and FIRE RETARDANT are not);
 *    - a real person's or business's name: TAYLOR, REMUND, PATCHLAMP,
 *      PLATEFUL, ANTHROPIC, CLAUDE (the sign's own TAYLOR REMUND excepted), so
 *      nobody puts words in his mouth about himself or his businesses;
 *    - an address or a number to call: WWW, HTTP, a dotted domain, an @
 *      handle, seven or more digits;
 * 3. `glyphs`: a character the sign face cannot draw (it has A–Z, 0–9, space
 *    and . , : ; - – — ' ’ " ! ? & / # ( ) + % *): emoji, other scripts.
 * 4. `long`: more than 16 characters.
 *
 * The slip for `blocked` never says which rule or which word.
 *
 * The lists are stored ROT13 so this file does not read as a list of slurs;
 * `decode` turns them back at load.
 */

export const MAX_WORDS = 16;

/** What the sign face (and the tape face) can draw: src/workshop/view/labels/fonts.ts CAPS. */
const DRAWABLE = new Set(" ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;-–—'’\"!?&/#()+%*");

const rot13 = (s: string): string => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const decode = (list: string): string[] => list.split(' ').map(rot13);

/** Whole words (ROT13). */
const WORDS = new Set(
  decode(
    'shpx shpxf shpxre shpxref shpxvat shpxrq zbgureshpxre fuvg fuvgf fuvggl fuvgr ohyyfuvg fuvgurnq penc penccl cvff cvffrq nff nffrf nefr nffubyr nffubyrf nefrubyr wnpxnff qhzonff ovgpu ovgpurf ovgpul onfgneq onfgneqf qnza qnzarq tbqqnza phag phagf pbpx pbpxf qvpx qvpxf qvpxurnq cevpx cevpxf chffl chffvrf gjng jnax jnaxre jnaxref gvg gvgf gvggl gvggvrf obbo obbof cravf cravfrf intvan intvanf phz phzzvat wvmm frk frkl cbea cbeab ahqr ahqrf anxrq ubeal qvyqb nany nahf ohggubyr oybjwbo unaqwbo evzwbo fyhg fyhgf fyhggl juber juberf zvys betl encr encrq encrf encvfg crqb crqbf crqbcuvyr vaprfg oqfz uragnv baylsnaf afsj kkk obare rerpgvba grfgvpyrf fpebghz pyvg avttre avttref avttn avttnf arteb artebrf pbba pbbaf wvtnobb fcvp fcvpf fcvpx jrgonpx jrgonpxf ornare ornaref puvax puvaxf tbbx tbbxf xvxr xvxrf urro ulzvr enturnq gbjryurnq cnxv cnxvf snttbg snttbgf snt sntf qlxr qlxrf genaal genaavrf furznyr ergneq ergneqf ergneqrq gneq gneqf fcnm zbatbybvq jbc qntb ubaxl erqfxva erqfxvaf vawha fdhnj unysoerrq penpxre penpxref anmv anmvf uvgyre urvy fvrt xxx fjnfgvxn nelna trabpvqr ubybpnhfg ylapu ylapuvat wvunq vfvf xlf fhvpvqr pbpnvar urebva zrgu sragnaly fpnz fpnzf fpnzzre senhq senhqfgre fhpxf fhpx ybfre ybfref vqvbg vqvbgf zbeba zbebaf fghcvq unpxrq cjarq',
  ),
);
/** Roots matched anywhere in the letters run together (ROT13). */
const ROOTS = decode('shpx avtt snttbg jrgonpx xvyylbhefrys juvgrcbjre wvtnobb');
/** Numbers that are hate or innuendo codes, matched as whole numbers. */
const NUMBERS = new Set(['69', '420', '1488', '88']);
/** Real names: never on tape (lower case, matched in the letters run together). */
const NAMES = ['taylor', 'remund', 'patchlamp', 'plateful', 'anthropic', 'claude'];
/** The sign's own words, which may always come back. */
const OWN = new Set(['TAYLOR REMUND', 'TAYLOR']);

const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's' };

export type TapeResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'empty' | 'blocked' | 'glyphs' | 'long'; readonly count?: number };

/** Capitals, accents dropped, quotes and trailing full stops off, spaces collapsed. */
export function normaliseWords(raw: string): string {
  let s = raw.normalize('NFKC').replace(/[“”„«»]/g, '"').replace(/‘/g, '’').replace(/\s+/g, ' ').trim();
  for (;;) {
    const m = /^(["'’])(.*)\1$/.exec(s) ?? /^(['"])(.*)’$/.exec(s);
    if (!m) break;
    s = (m[2] ?? '').trim();
  }
  s = s.replace(/\.+$/, '').trim();
  return s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

/** Stretched letters shrunk: runs of three or more to two (`to` 2), or every run to one (`to` 1). */
const shrink = (s: string, to: 1 | 2): string => (to === 2 ? s.replace(/([a-z])\1{2,}/g, '$1$1') : s.replace(/([a-z])\1+/g, '$1'));

function wordBlocked(token: string): boolean {
  if (NUMBERS.has(token)) return true;
  if (!/[a-z]/.test(token)) return false;
  const folded = [...token].map((c) => LEET[c] ?? c).join('');
  if (folded.includes('*')) {
    const re = new RegExp(`^${folded.replace(/[^a-z*]/g, '').replace(/\*/g, '[a-z]')}$`);
    for (const w of WORDS) if (re.test(w)) return true;
    return false;
  }
  const letters = folded.replace(/[^a-z]/g, '');
  return WORDS.has(letters) || WORDS.has(shrink(letters, 2)) || WORDS.has(shrink(letters, 1));
}

/** True when the words may not go on tape or the sign (rule 2 above). Takes normalised words. */
export function isBlocked(words: string): boolean {
  if (OWN.has(words)) return false;
  const lower = words.toLowerCase();
  // An address or a number to call.
  if (/www|https?|:\/\//.test(lower) || /[a-z0-9]\.[a-z]{2,}/.test(lower) || /@[a-z0-9]/.test(lower)) return true;
  if (lower.replace(/[^0-9]/g, '').length >= 7) return true;
  const digits = lower.replace(/[^0-9]/g, '');
  if (digits.includes('1488')) return true;
  // Whole words; a run of single letters (S H I T, F.U.C.K) is read as one word too.
  const tokens = lower.split(/[^a-z0-9@$*]+/).filter(Boolean);
  for (const token of tokens) if (wordBlocked(token)) return true;
  const spelled = lower.match(/(?:\b[a-z0-9@$*]\b[\s.\-_]*){3,}/g) ?? [];
  for (const run of spelled) if (wordBlocked(run.replace(/[\s.\-_]/g, ''))) return true;
  // Letters run together.
  const run = [...lower].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
  const forms = [run, shrink(run, 2)];
  for (const root of ROOTS) if (forms.some((f) => f.includes(root))) return true;
  const one = shrink(run, 1);
  for (const root of ROOTS) {
    const r1 = shrink(root, 1);
    if (r1.length >= 4 && one.includes(r1)) return true;
  }
  for (const name of NAMES) if (run.includes(name)) return true;
  return false;
}

/** The tape rule, in full: normalised words, or why not. */
export function checkWords(raw: string): TapeResult {
  const text = normaliseWords(raw);
  if (text === '') return { ok: false, reason: 'empty' };
  if (isBlocked(text)) return { ok: false, reason: 'blocked' };
  for (const c of text) if (!DRAWABLE.has(c)) return { ok: false, reason: 'glyphs' };
  const count = [...text].length;
  if (count > MAX_WORDS) return { ok: false, reason: 'long', count };
  return { ok: true, text };
}
