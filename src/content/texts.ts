/**
 * The phone's words (src/content/texts.json): Patch's replies, the names of
 * the paints and the window's pictures, and the ready-made texts for each
 * jack. The simulation speaks in reply ids (src/workshop/sim/instruct); this
 * turns a reply into the sentence on the phone. Content imports nothing
 * outside src/content, so the reply shape is restated here structurally.
 */
import textsJson from './texts.json';
import { assertContent } from './schema.ts';

const raw = assertContent(textsJson, 'src/content/texts.json');

interface Line {
  text: string;
  kind: string;
  source?: string;
  provisional?: boolean;
}
interface ReadyText extends Line {
  from: string;
}

/** One reply line as the simulation hands it over (sim/instruct/types.ts `ReplyLine`). */
export interface ReplyLineIn {
  readonly id: string;
  readonly colour?: string;
  readonly words?: string;
  readonly picture?: string;
  readonly count?: number;
}

const replies: Readonly<Record<string, Line>> = raw.replies;
const colours: Readonly<Record<string, Line>> = raw.colours;
const pictures: Readonly<Record<string, Line>> = raw.pictures;

/** Every reply id texts.json holds. */
export const TEXT_REPLY_IDS: readonly string[] = Object.keys(replies);

/** The paints in palette order (the order texts.json lists them), without the lamp's own `warm`. */
const PAINT_ORDER = Object.keys(colours).filter((k) => k !== 'warm');

/** "a, b and c". */
function list(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function nameOf(table: Readonly<Record<string, Line>>, id: string | undefined, what: string): string {
  const e = id === undefined ? undefined : table[id];
  if (!e) throw new Error(`texts: unknown ${what} ${JSON.stringify(id)}`);
  return e.text;
}

/** The sentence for one reply line. Throws on an unknown id or a missing slot value. */
export function renderLine(line: ReplyLineIn): string {
  const entry = replies[line.id];
  if (!entry) throw new Error(`texts: unknown reply id ${JSON.stringify(line.id)}`);
  const out = entry.text.replace(/\{(\w+)\}/g, (_m, slot: string) => {
    switch (slot) {
      case 'colour':
        return nameOf(colours, line.colour, 'colour');
      case 'picture':
        return nameOf(pictures, line.picture, 'picture');
      case 'words':
        if (line.words === undefined) throw new Error(`texts: reply ${line.id} needs words`);
        return line.words;
      case 'count':
        if (line.count === undefined) throw new Error(`texts: reply ${line.id} needs a count`);
        return String(line.count);
      case 'paints':
        return list(PAINT_ORDER.map((k) => colours[k]!.text));
      case 'pictures':
        return list(Object.values(pictures).map((p) => p.text));
      default:
        throw new Error(`texts: reply ${line.id} has an unknown slot {${slot}}`);
    }
  });
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Patch's whole text back: its lines, joined with a space. */
export function renderReply(reply: readonly ReplyLineIn[]): string {
  return reply.map(renderLine).join(' ');
}

const ready = (key: keyof typeof raw.ready): readonly string[] => (raw.ready[key] as readonly ReadyText[]).map((t) => t.text);

/** The ready-made texts the phone offers first (§ B10): the jack's own, then the ones every jack answers. */
export const readyTexts = {
  storefront: ready('storefront'),
  platen: ready('platen'),
  belt: ready('belt'),
  lamp: ready('lamp'),
  every: ready('every'),
} as const;

/** The plain name of a paint token or `warm` ("red" for `cable-red`). */
export const colourName = (token: string): string => nameOf(colours, token, 'colour');
