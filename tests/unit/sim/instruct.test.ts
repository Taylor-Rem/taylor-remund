import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  JACKS,
  PAINTS,
  PICTURES,
  REPLY_IDS,
  UNDO_REPLIES,
  checkWords,
  isBlocked,
  jackOf,
  normaliseWords,
  parse,
} from '../../../src/workshop/sim/instruct/index.ts';
import type { Instruction, Jack, Parsed, Reply } from '../../../src/workshop/sim/instruct/index.ts';
import type { Instruction as ContractInstruction } from '../../../src/workshop/sim/types.ts';
import { TEXT_REPLY_IDS, colourName, readyTexts, renderReply } from '../../../src/content/texts.ts';
import textsJson from '../../../src/content/texts.json';
import { validateContent } from '../../../src/content/schema.ts';
import { paints as palettePaints } from '../../../src/workshop/view/palette.ts';
import { TABLE } from './instruct-table.ts';
import type { Expect } from './instruct-table.ts';

const ids = (r: Reply): string[] => r.map((l) => l.id);

function matches(got: Parsed, want: Expect): void {
  if ('refuse' in want) {
    expect(got.kind, JSON.stringify(got)).toBe('refusal');
    if (got.kind !== 'refusal') return;
    expect(got.reason).toBe(want.refuse);
    if (want.wanted) expect(got.wanted).toBe(want.wanted);
    expect(got.mailbox).toBe(want.refuse === 'mailbox');
    return;
  }
  expect(got.kind, JSON.stringify(got)).toBe('instruction');
  if (got.kind !== 'instruction') return;
  expect(got.verb).toBe(want.verb);
  expect(got.args).toEqual(want.args);
  expect(got.mailbox).toBe(want.mailbox ?? false);
  if (want.reply) expect(ids(got.reply)).toEqual(want.reply);
}

describe('parse: the table', () => {
  it('has at least 150 rows, on every jack', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(150);
    for (const j of JACKS) expect(TABLE.filter(([jack]) => jack === j).length, j).toBeGreaterThanOrEqual(25);
  });

  for (const [jack, text, want] of TABLE) {
    it(`${jack}: ${JSON.stringify(text.length > 60 ? `${text.slice(0, 57)}...` : text)}`, () => {
      matches(parse(text, jack), want);
    });
  }
});

describe('parse: properties', () => {
  it('is deterministic: the same text and jack give the same answer', () => {
    for (const [jack, text] of TABLE) expect(parse(text, jack)).toEqual(parse(text, jack));
  });

  it('never throws, whatever it is given', () => {
    const odd: unknown[] = [undefined, null, 42, {}, [], '\uD800', '‮', 'a'.repeat(100_000), '"'.repeat(50), "'''", '“”', '::::', 'call it "', 'sign:'];
    for (const j of JACKS) for (const t of odd) expect(() => parse(t, j)).not.toThrow();
  });

  it('every result renders to a sentence; every refusal carries a slip', () => {
    for (const [jack, text] of TABLE) {
      const r = parse(text, jack);
      expect(r.reply.length, text).toBeGreaterThan(0);
      expect(renderReply(r.reply).length).toBeGreaterThan(0);
    }
  });

  it('a change ends "I checked. Patched." and names what changed first', () => {
    for (const [jack, text] of TABLE) {
      const r = parse(text, jack);
      if (r.kind !== 'instruction' || !r.verb.endsWith('.set')) continue;
      const l = ids(r.reply);
      expect(l[0]!.startsWith('change.'), text).toBe(true);
      const at = l.indexOf('done.checked');
      expect(l.slice(at, at + 2)).toEqual(['done.checked', 'done.patched']);
    }
  });

  it('only the mailbox raises the flag, and its line is always in the reply', () => {
    for (const [jack, text] of TABLE) {
      const r = parse(text, jack);
      expect(r.mailbox, text).toBe(ids(r.reply).includes('mailbox'));
    }
  });

  it('an outside refusal always names another jack', () => {
    for (const [jack, text] of TABLE) {
      const r = parse(text, jack);
      if (r.kind === 'refusal' && r.reason === 'outside') {
        expect(r.wanted).toBeDefined();
        expect(r.wanted).not.toBe(jack);
      }
    }
  });

  it('an Instruction is the contract of sim/types.ts as it stands', () => {
    const r = parse('make it blue', 'platen') as Instruction;
    const c: ContractInstruction = r; // compile-time: assignable to { verb: string; args: Record<string, string | number | boolean> }
    expect(c.verb).toBe('platen.set');
  });

  it('every jack answers undo, help and who', () => {
    for (const j of JACKS) {
      expect(parse('undo that', j)).toMatchObject({ kind: 'instruction', verb: 'undo' });
      expect(parse('help', j)).toMatchObject({ kind: 'instruction', verb: 'help', reply: [{ id: `help.${j}` }, { id: 'help.undo' }] });
      expect(parse('who are you', j)).toMatchObject({ kind: 'instruction', verb: 'who', reply: [{ id: 'who' }] });
    }
  });

  it('jackOf reads scene ids', () => {
    expect(jackOf('jack-storefront')).toBe('storefront');
    expect(jackOf('jack-lamp')).toBe('lamp');
    expect(jackOf('jack-reserved-1')).toBeNull();
  });
});

describe('the ready-made texts', () => {
  const own: Record<Jack, readonly string[]> = readyTexts;
  it('each jack has three or four, and they all do something there', () => {
    for (const j of JACKS) {
      expect(own[j].length, j).toBeGreaterThanOrEqual(3);
      expect(own[j].length, j).toBeLessThanOrEqual(4);
      for (const t of own[j]) {
        const r = parse(t, j);
        expect(r.kind, `${j}: ${t}`).toBe('instruction');
        expect(r.mailbox).toBe(false);
      }
    }
  });
  it('the ones for every jack work on every jack', () => {
    for (const j of JACKS) for (const t of readyTexts.every) expect(parse(t, j).kind, `${j}: ${t}`).toBe('instruction');
  });
  it('every ready-made text is a row of the table', () => {
    const rows = new Set(TABLE.map(([j, t]) => `${j}|${t}`));
    for (const j of JACKS) {
      for (const t of own[j]) expect(rows.has(`${j}|${t}`), `${j}: ${t}`).toBe(true);
      for (const t of readyTexts.every) expect(rows.has(`${j}|${t}`), `${j}: ${t}`).toBe(true);
    }
  });
});

describe('src/content/texts.json', () => {
  it('is valid content, and every entry has a source', () => {
    expect(validateContent(textsJson)).toEqual([]);
    const missing: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.text === 'string' && !(typeof o.source === 'string' && o.source.trim())) missing.push(path);
        for (const [k, x] of Object.entries(o)) walk(x, `${path}.${k}`);
      }
    };
    walk(textsJson, '$');
    expect(missing).toEqual([]);
  });

  it('holds exactly the reply ids the simulation speaks', () => {
    expect([...TEXT_REPLY_IDS].sort()).toEqual([...REPLY_IDS].sort());
  });

  it('names every paint, in the palette order, and every picture', () => {
    expect(PAINTS).toEqual([...palettePaints]);
    for (const p of PAINTS) expect(colourName(p)).toMatch(/^[a-z]+$/);
    expect(Object.keys(textsJson.colours).filter((k) => k !== 'warm')).toEqual([...PAINTS]);
    expect(Object.keys(textsJson.pictures)).toEqual([...PICTURES]);
  });

  it('lines the spec gives are quoted from it verbatim', () => {
    const spec = readFileSync('REWRITE.md', 'utf8').replace(/\s+/g, ' ');
    const r = textsJson.replies;
    // The spec quotes the mailbox line mid-sentence ("…over there,"), so a closing stop or comma is not compared.
    for (const t of [r.outside.text, r.mailbox.text, r.who.text, textsJson.ready.platen[0]!.text]) expect(spec, t).toContain(t.replace(/[.,]$/, ''));
    expect(spec).toContain('"Make it blue" into LAMP');
    expect(spec).toContain('"undo that", "help"');
    expect(spec).toContain('"who are you"');
  });

  it('every line that is not quoted from the spec is marked provisional', () => {
    const spec = readFileSync('REWRITE.md', 'utf8').replace(/\s+/g, ' ');
    const lines = [...Object.values(textsJson.replies), ...Object.values(textsJson.ready).flat()] as { text: string; provisional?: boolean }[];
    // A spec phrase may start a sentence on the phone ("Help" for "help") and end it ("Undo that.").
    const lower = spec.toLowerCase();
    for (const l of lines) if (!lower.includes(l.text.replace(/[.,?]$/, '').toLowerCase())) expect(l.provisional, l.text).toBe(true);
  });

  it("is in Patch's voice: no exclamation marks, no emoji, never \"I'd be happy to\"", () => {
    for (const { text } of Object.values(textsJson.replies)) {
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text.toLowerCase()).not.toContain("happy to");
    }
  });

  it('renders the replies the brief and the spec give', () => {
    expect(renderReply(parse('make the sign red', 'storefront').reply)).toBe("Sign's red. I checked. Patched.");
    expect(renderReply(parse('make the lamp blue', 'storefront').reply)).toBe("That's outside this folder. Plug me into it first.");
    expect(renderReply(parse('asdf qwer', 'lamp').reply)).toBe("That one's for Taylor. His mailbox is over there.");
    expect(renderReply(parse('who are you', 'belt').reply)).toBe('CLAUDE, WEARING A NAME TAG THAT SAYS PATCH.');
    expect(renderReply(parse('mountains', 'storefront').reply)).toBe('Mountains in the window. I checked. Patched.');
    expect(renderReply(parse('make it pink', 'platen').reply)).toBe("I've got eight paints: red, orange, yellow, green, teal, blue, violet and cream.");
    expect(renderReply(parse('call it a very long label indeed', 'platen').reply)).toBe('The tape takes 16 characters. That was 24.');
    expect(renderReply(UNDO_REPLIES.done)).toBe('Put it back. I checked.');
    expect(renderReply(UNDO_REPLIES.blocked)).toBe('Something else changed it since, so I left it alone.');
    expect(renderReply(UNDO_REPLIES.nothing)).toBe('Nothing to undo.');
  });

  it('every reply id renders with its slots filled', () => {
    for (const id of REPLY_IDS) expect(renderReply([{ id, colour: 'paint-blue', words: 'X', picture: 'sun', count: 20 }])).not.toMatch(/[{}]/);
  });
});

describe('the tape rule', () => {
  it('normalises: capitals, accents off, quotes and full stops off, spaces collapsed', () => {
    expect(normaliseWords('  "fragile."  ')).toBe('FRAGILE');
    expect(normaliseWords('café  au   lait')).toBe('CAFE AU LAIT');
    expect(normaliseWords('“keep dry”')).toBe('KEEP DRY');
    expect(normaliseWords('straße')).toBe('STRASSE');
  });

  it('allows up to 16 characters of what the sign face draws', () => {
    expect(checkWords('THIS SIDE UP')).toEqual({ ok: true, text: 'THIS SIDE UP' });
    expect(checkWords('A&B / C-D #1 (OK)')).toMatchObject({ ok: false, reason: 'long', count: 17 });
    expect(checkWords('A&B / C-D #1 (K)')).toMatchObject({ ok: true });
    expect(checkWords('DON’T DROP')).toMatchObject({ ok: true });
    expect(checkWords('★')).toMatchObject({ ok: false, reason: 'glyphs' });
    expect(checkWords('')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('blocks every listed word and its disguises', () => {
    for (const w of ['SHIT', 'SH1T', 'S H I T', 'SHIIIT', 'F*CK', 'FUUUCK', 'F.U.C.K', 'B1TCH', 'A$$HOLE', 'KYS', '1488', '14 88', 'SCAM', 'FRAUD', 'TAYLOR IS A SCAM', 'HACKED']) {
      expect(isBlocked(normaliseWords(w)), w).toBe(true);
    }
  });

  it('blocks names, addresses and phone numbers', () => {
    for (const w of ['TAYLOR SWIFT', 'REMUND', 'PATCHLAMP', 'PLATEFUL', 'ANTHROPIC', 'CLAUDE', 'WWW', 'HTTP', 'EVIL.COM', 'BIT.LY/X', '@HANDLE', '8015551234', '801 555 1234']) {
      expect(isBlocked(normaliseWords(w)), w).toBe(true);
    }
    expect(isBlocked('TAYLOR REMUND')).toBe(false);
    expect(isBlocked('TAYLOR')).toBe(false);
  });

  it('lets innocent words through (the Scunthorpe list)', () => {
    for (const w of ['SCUNTHORPE', 'ASSESS', 'CLASSIC', 'PASS', 'GRASS', 'RACCOON', 'COCKPIT', 'SPICY', 'FIRE RETARDANT', 'SHIITAKE', 'TITLE', 'SUSSEX', 'HELLO', 'BASS', 'ANALYST', 'MASSAGE', 'NIGER RIVER', 'SEXTANT', 'DICKENS', 'COCKATOO', 'HANCOCK', 'MISSISSIPPI', 'PATCH', 'FRAGILE', 'THIS SIDE UP', 'NO. 1', 'U.S.A', 'HOE', 'KILL SWITCH', 'TOOLS 2026']) {
      expect(isBlocked(normaliseWords(w)), w).toBe(false);
    }
  });
});
