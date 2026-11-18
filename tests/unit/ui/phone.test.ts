import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateContent } from '../../../src/content/schema.ts';
import phoneJson from '../../../src/content/phone.json';
import { SUBSET } from '../../../src/workshop/view/labels/fonts.ts';
import { PHONE_COLOURS, TEXT_PAIRS, contrast, cssVariables } from '../../../src/workshop/ui/phone/colours.ts';
import { fakeLine } from '../../../src/workshop/ui/phone/fake.ts';
import {
  charsLeft,
  isWorking,
  lineAnnouncement,
  lineName,
  MAX_CHARS,
  readyFor,
  reduce,
  replay,
  toSend,
  type PhoneState,
} from '../../../src/workshop/ui/phone/model.ts';
import { MAX_TEXT } from '../../../src/workshop/sim/instruct/index.ts';
import type { PhoneEvent } from '../../../src/workshop/ui/phone/types.ts';

const ROOT = join(import.meta.dirname, '../../..');

/** A stepped clock for the fake line. */
function clock() {
  let now = 0;
  const due: { at: number; fn: () => void }[] = [];
  return {
    after: (ms: number, fn: () => void) => void due.push({ at: now + ms, fn }),
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        due.sort((a, b) => a.at - b.at);
        const next = due[0];
        if (!next || next.at > until) break;
        due.shift();
        now = next.at;
        next.fn();
      }
      now = until;
    },
  };
}

describe('phone content', () => {
  it('is valid content, and every line is drawable in the tape face', () => {
    expect(validateContent(phoneJson)).toEqual([]);
    const all: string[] = [];
    const walk = (n: unknown): void => {
      if (n && typeof n === 'object') {
        if (typeof (n as { text?: unknown }).text === 'string') all.push((n as { text: string }).text);
        Object.values(n).forEach(walk);
      }
    };
    walk(phoneJson);
    for (const t of all) for (const ch of t) expect(SUBSET.tape, `${JSON.stringify(t)} has ${ch}`).toContain(ch);
  });

  it('names every line', () => {
    expect(lineName('storefront')).toBe('Storefront line');
    expect(lineName(null)).toBe('Not plugged in');
    expect(lineAnnouncement('lamp')).toBe('Now on the lamp line.');
  });
});

describe('phone colours', () => {
  it.each(TEXT_PAIRS)('%s on %s reaches 4.5:1', (a, b) => {
    expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5);
  });

  it('come from the palette only: no colour literal in the panel files', () => {
    for (const f of ['phone.css', 'panel.ts', 'model.ts', 'colours.ts', 'fake.ts']) {
      const src = readFileSync(join(ROOT, 'src/workshop/ui/phone', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/#[0-9a-f]{3,8}\b(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\(/i);
    }
    const css = readFileSync(join(ROOT, 'src/workshop/ui/phone/phone.css'), 'utf8');
    // no gradient is ever painted: one may only cut an alpha mask
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '').split(/[;{}]/);
    for (const d of declarations.filter((d) => /gradient\(/.test(d))) expect(d.trim()).toMatch(/^(-webkit-)?mask\s*:/);
    const used = new Set([...css.matchAll(/var\(--ph-([\w-]+)\)/g)].map((m) => m[1]!));
    for (const role of used) expect(Object.keys(PHONE_COLOURS), role).toContain(role);
    expect(Object.keys(cssVariables())).toHaveLength(Object.keys(PHONE_COLOURS).length);
  });
});

describe('phone model', () => {
  const sent = (id: number, text: string, jack: 'storefront' | 'lamp' = 'storefront'): PhoneEvent => ({ type: 'sent', id, jack, text });

  it('names the line before the first text and again when the line changes', () => {
    const s = replay('storefront', [sent(1, 'a'), sent(2, 'b'), sent(3, 'c', 'lamp')]);
    expect(s.items.map((i) => i.kind)).toEqual(['line', 'sent', 'sent', 'line', 'sent']);
  });

  it('shows working, then puts the answer in its place', () => {
    let s: PhoneState = replay('storefront', [sent(1, 'Make the sign red.')]);
    s = reduce(s, { type: 'working', id: 1 });
    expect(isWorking(s)).toBe(true);
    s = reduce(s, { type: 'reply', id: 1, reply: [{ id: 'change.sign', colour: 'cable-red' }, { id: 'done.patched' }], mailbox: false });
    expect(isWorking(s)).toBe(false);
    expect(s.items.at(-1)).toEqual({ kind: 'answer', id: 1, text: "Sign's red. Patched.", refused: false });
  });

  it('follows the cord', () => {
    const s = reduce(replay('storefront', []), { type: 'jack', jack: null });
    expect(s.jack).toBeNull();
    expect(readyFor(null)).toEqual({ own: [], every: [] });
    expect(readyFor('belt').own).toContain('Go faster.');
    expect(readyFor('belt').every).toContain('Undo that.');
  });

  it('sends at most 240 characters, trimmed, and nothing when empty', () => {
    expect(MAX_CHARS).toBe(MAX_TEXT);
    expect(toSend('   ')).toBeNull();
    expect(toSend('  hi  ')).toBe('hi');
    expect([...toSend('x'.repeat(300))!]).toHaveLength(240);
    expect(charsLeft('x'.repeat(199))).toBeNull();
    expect(charsLeft('x'.repeat(230))).toBe('10 left');
  });
});

describe('the fake line', () => {
  it('begins with the attract exchange on the platen line', () => {
    const line = fakeLine();
    const s = replay(line.jack, line.log());
    expect(s.jack).toBe('storefront');
    expect(s.items[0]).toEqual({ kind: 'line', jack: 'platen' });
    expect(s.items[1]).toMatchObject({ kind: 'sent', text: 'Make it blue.' });
    expect(s.items[2]).toMatchObject({ kind: 'answer', refused: false });
  });

  it('answers sent, working, then the reply, one job at a time', () => {
    const c = clock();
    const line = fakeLine({ attract: false, after: c.after, pickUp: 100, work: 1000 });
    const seen: string[] = [];
    line.subscribe((e) => seen.push(`${e.type}${'id' in e ? e.id : ''}`));
    line.send('Make the sign red.');
    line.send('Who are you?');
    expect(seen).toEqual(['sent1', 'sent2']);
    c.advance(100);
    expect(seen.at(-1)).toBe('working1');
    c.advance(1000);
    expect(seen.at(-1)).toBe('reply1');
    c.advance(1100);
    expect(seen).toEqual(['sent1', 'sent2', 'working1', 'reply1', 'working2', 'reply2']);
  });

  it('refuses what is outside the folder, with the true answer', () => {
    const c = clock();
    const line = fakeLine({ attract: false, after: c.after, jack: 'lamp' });
    line.send('Make the sign red.');
    c.advance(5000);
    const s = replay(line.jack, line.log());
    expect(s.items.at(-1)).toMatchObject({ kind: 'answer', refused: true, text: "That's outside this folder. Plug me into it first." });
  });

  it('sends nothing while the cord is out', () => {
    const line = fakeLine({ attract: false });
    line.plug(null);
    line.send('hello');
    expect(line.log().map((e) => e.type)).toEqual(['jack']);
  });
});
