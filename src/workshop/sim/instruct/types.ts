/**
 * The words Patch understands (REWRITE.md § B2 X1, § D 3 and 4).
 *
 * `parse(text, jack)` turns a visitor's text into an `Instruction` for the
 * station on the line, or a `Refusal`. Neither holds a sentence: a reply is a
 * list of content ids (src/content/texts.json `replies`) with the values
 * that fill their slots, resolved to words by `renderReply` in
 * src/content/texts.ts.
 *
 * `Instruction` here is a refinement of the contract in sim/types.ts
 * (`{ verb: string; args: Record<string, string | number | boolean> }`): a
 * machine's `instruct(cmd, cause)` takes it as it is.
 */
import type { PaintName } from '../types.ts';

/** The four live jacks on the switchboard (§ B2 X1). Scene ids are `jack-<name>`. */
export type Jack = 'storefront' | 'platen' | 'belt' | 'lamp';
export const JACKS: readonly Jack[] = ['storefront', 'platen', 'belt', 'lamp'];

/** One of the 8 paints, by palette token name (sim treats them as opaque strings). */
export type Colour = PaintName;
/** The lamp takes a paint, or goes back to its own warm light. */
export type LampColour = Colour | 'warm';

/** What the storefront window can show. PROVISIONAL: the storefront's own set decides (V-storefront). */
export type Picture = 'mountains' | 'sun' | 'boat' | 'tree' | 'house';
/** A picture, `none` (an empty frame) or `next` (whichever comes after the one showing). */
export type PictureArg = Picture | 'none' | 'next';

// Each `args` is a type alias (not an interface) so it stays assignable to the
// contract's Record<string, string | number | boolean>. Absent keys mean "leave it".

/** STOREFRONT: sign colour, sign words, awning colour, open or closed, a picture in the window. */
export type StorefrontArgs = {
  readonly sign?: Colour;
  /** Already normalised: capitals, at most 16 characters, passed the tape rule. */
  readonly words?: string;
  readonly awning?: Colour;
  readonly open?: boolean;
  readonly picture?: PictureArg;
};
/** PLATEN: colour and label of whatever is on the tray. */
export type PlatenArgs = {
  readonly colour?: Colour;
  /** Already normalised: capitals, at most 16 characters, passed the tape rule. */
  readonly label?: string;
};
/** BELT: faster, slower, stop, go, reverse. `speed` is one notch of the dial up (1) or down (-1). */
export type BeltArgs = {
  readonly speed?: 1 | -1;
  readonly running?: boolean;
  /** `flip` is "reverse it"; `forward`/`backward` say which way outright. */
  readonly direction?: 'forward' | 'backward' | 'flip';
};
/** LAMP: brighter, dimmer, a colour, off, on. `level` is one step up (1) or down (-1). */
export type LampArgs = {
  readonly level?: 1 | -1;
  readonly on?: boolean;
  readonly colour?: LampColour;
};
export type NoArgs = { readonly [k: string]: never };

/** Every reply line Patch can send; each is a key of `replies` in src/content/texts.json. */
export const REPLY_IDS = [
  // a change made (one line per field changed, in this order)
  'change.sign',
  'change.words',
  'change.awning',
  'change.open',
  'change.closed',
  'change.picture',
  'change.picture.none',
  'change.picture.next',
  'change.platen.colour',
  'change.platen.label',
  'change.belt.faster',
  'change.belt.slower',
  'change.belt.stop',
  'change.belt.go',
  'change.belt.flip',
  'change.belt.forward',
  'change.belt.backward',
  'change.lamp.brighter',
  'change.lamp.dimmer',
  'change.lamp.off',
  'change.lamp.on',
  'change.lamp.colour',
  'change.lamp.warm',
  // after the change lines
  'done.checked',
  'done.patched',
  // undo that (the station picks one by what the history says)
  'undo.done',
  'undo.nothing',
  'undo.blocked',
  // help, who, thanks
  'help.storefront',
  'help.platen',
  'help.belt',
  'help.lamp',
  'help.undo',
  'who',
  'thanks',
  // refusals
  'outside',
  'mailbox',
  'not-here',
  'colour.unknown',
  'picture.unknown',
  'words.empty',
  'words.long',
  'words.glyphs',
  'words.blocked',
  // what a machine answers when the change cannot apply (the station's Outcome.wanted)
  'platen.empty',
  'belt.fastest',
  'belt.slowest',
  'lamp.brightest',
  'lamp.dimmest',
] as const;
export type ReplyId = (typeof REPLY_IDS)[number];

/** One line of a reply, with the values its slots take. `words` is the visitor's own (normalised) text. */
export interface ReplyLine {
  readonly id: ReplyId;
  readonly colour?: LampColour;
  readonly words?: string;
  readonly picture?: Picture;
  readonly count?: number;
}
/** Patch's text back: lines joined with a space when rendered. */
export type Reply = readonly ReplyLine[];

interface InstructionBase {
  readonly kind: 'instruction';
  /** The jack the text was sent to (the cord is in it). */
  readonly jack: Jack;
  /** What Patch texts back once the change is made and checked. For `undo` this is the "done" reply; see `UNDO_REPLIES`. */
  readonly reply: Reply;
  /** Part of the text was for Taylor (its line is in `reply`): raise the mailbox flag. Nothing is sent. */
  readonly mailbox: boolean;
}

export type Instruction =
  | (InstructionBase & { readonly verb: 'storefront.set'; readonly args: StorefrontArgs })
  | (InstructionBase & { readonly verb: 'platen.set'; readonly args: PlatenArgs })
  | (InstructionBase & { readonly verb: 'belt.set'; readonly args: BeltArgs })
  | (InstructionBase & { readonly verb: 'lamp.set'; readonly args: LampArgs })
  /** "undo that": take back the visitor's last text-made change (§ E5 decides which and whether). */
  | (InstructionBase & { readonly verb: 'undo'; readonly args: NoArgs })
  /** "help": the reply lists what this jack can change. Nothing changes. */
  | (InstructionBase & { readonly verb: 'help'; readonly args: NoArgs })
  /** "who are you". Nothing changes. */
  | (InstructionBase & { readonly verb: 'who'; readonly args: NoArgs })
  /** "thanks", "nice". Nothing changes. */
  | (InstructionBase & { readonly verb: 'thanks'; readonly args: NoArgs });

export type Verb = Instruction['verb'];

export type RefusalReason =
  /** The text is for a station the cord is not in (`wanted` says which). */
  | 'outside'
  /** Patch cannot parse it: it is for Taylor; the mailbox flag goes up. */
  | 'mailbox'
  /** Nothing on any line does that here (paint the belt, switch the platen off): the reply says what this jack can do. */
  | 'not-here'
  /** A colour that is not one of the eight paints. */
  | 'colour-unknown'
  /** A picture the window does not have. */
  | 'picture-unknown'
  /** Label or sign words that break the tape rule (see tape.ts). */
  | 'words-empty'
  | 'words-long'
  | 'words-glyphs'
  | 'words-blocked';

export interface Refusal {
  readonly kind: 'refusal';
  readonly jack: Jack;
  readonly reason: RefusalReason;
  /** For `outside`: the jack the text was meant for. */
  readonly wanted?: Jack;
  /** The slip Patch texts back. Never a bare "no". */
  readonly reply: Reply;
  /** True for `mailbox`: raise the flag. Nothing is sent anywhere. */
  readonly mailbox: boolean;
}

export type Parsed = Instruction | Refusal;
