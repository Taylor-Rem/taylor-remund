// REWRITE.md § B2 X1 end to end (S3): the phone talks to whatever the cord is plugged into; the same
// text into each of the four jacks does four different things; the cord moved mid-conversation; the
// capped jacks; every jack answers "undo that", "help" and "who are you"; the station on a line answers
// the moment the plug seats. On the whole bench under real Rapier.
import { describe, expect, test } from 'vitest';
import { benchWorld, putOn, tape, waitFor } from './line-helpers.ts';
import { answer, lampView, lineView, patchView, platenView, plug, send, shopView, textAndWait, traySpot, untilPatch } from './patchlamp-helpers.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';
import { renderReply } from '../../src/content/texts.ts';
import type { Effect } from '../../src/workshop/sim/types.ts';

describe('X1: the same text into each of the four jacks does four different things', () => {
  test('"Make it blue." into STOREFRONT, PLATEN (a crate on the tray), BELT and LAMP', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(30);
    // a crate on the platen's tray: taken in and held
    putOn(w, t, 'crate-3', traySpot(), 120);
    expect(waitFor(w, t, 'crate-3', 'in')).toBe(true);
    expect(w.part('crate-3')!.location).toEqual({ at: 'in', station: 'patchlamp', mouth: 'platen' });
    expect(platenView(w).onTray).toBe('crate-3');

    const effectsOf = (from: number): Effect[] => t.events.filter((x) => x.step > from && x.e.type === 'effect').map((x) => (x.e as { effect: Effect }).effect);

    // STOREFRONT (the cord starts there): the sign
    expect(lineView(w).line).toBe('storefront');
    let from = w.step;
    const shop = textAndWait(w, t, 'Make it blue.');
    expect(shop.words).toBe("Sign's blue. I checked. Patched.");
    expect(shopView(w).sign).toBe('paint-blue');
    expect(effectsOf(from).map((e) => `${e.target}.${e.field}`)).toEqual(['storefront.sign']);

    // PLATEN: the crate on the tray
    plug(w, t, 'jack-platen');
    expect(lineView(w).line).toBe('platen');
    from = w.step;
    const pl = textAndWait(w, t, 'Make it blue.');
    expect(pl.words).toBe('Painted it blue. I checked. Patched.');
    expect(w.part('crate-3')!.colour).toBe('paint-blue');
    expect(effectsOf(from).map((e) => `${e.target}.${e.field}`)).toEqual(['crate-3.colour']);

    // BELT: a belt has no paint; it says what it can do here
    plug(w, t, 'jack-belt');
    from = w.step;
    const bl = textAndWait(w, t, 'Make it blue.');
    expect(bl.e.type).toBe('line.refused');
    expect(bl.words).toBe('Not on this line. This is the belt line. I can make it faster or slower, stop it, start it, or reverse it.');
    expect(effectsOf(from)).toEqual([]);

    // LAMP: the light of the whole workshop
    plug(w, t, 'jack-lamp');
    from = w.step;
    const lp = textAndWait(w, t, 'Make it blue.');
    expect(lp.words).toBe("Lamp's blue. I checked. Patched.");
    expect(lampView(w).colour).toBe('paint-blue');
    expect(effectsOf(from).map((e) => `${e.target}.${e.field}`)).toEqual(['lamp.colour']);

    // four texts that changed something, four transactions, each with the text's jack as its subject
    expect(w.undoStack().filter((x) => x.kind === 'text').map((x) => x.subject)).toEqual(['jack-storefront', 'jack-platen', 'jack-lamp']);
  });

  test('the cord moved mid-conversation: the job on the old line is dropped with nothing written; the next text goes to the new line', async () => {
    const w = await benchWorld();
    const t = tape(w);
    t.run(10);
    const n = send(w, t, 'make it red');
    expect(untilPatch(w, t, 'drawer')).toBe(true);
    expect(patchView(w).drawer).toBe('jack-storefront');
    plug(w, t, 'jack-lamp');
    const a = answer(t, n);
    expect(a.e).toMatchObject({ type: 'line.refused', reason: 'cancelled' });
    expect(renderReply(a.e.reply)).toBe('Line dropped. Nothing changed.');
    expect(shopView(w).sign).toBe('paint-green');
    expect(w.undoStack().filter((x) => x.kind === 'text')).toEqual([]);
    // Patch looks at the dead plug, then at the visitor
    const states = t.of('crew.state').filter((x) => x.e.id === 'patch').map((x) => x.e.state);
    expect(states).toContain('stare');
    t.run(Math.round(1.6 * HZ));
    expect(t.of('crew.state').filter((x) => x.e.id === 'patch').map((x) => x.e.state)).toContain('look');
    expect(patchView(w).state).toBe('seated');
    // the same words, now on the lamp line
    const lp = textAndWait(w, t, 'make it red');
    expect(lp.words).toBe("Lamp's red. I checked. Patched.");
    expect(lampView(w).colour).toBe('cable-red');
    expect(shopView(w).sign).toBe('paint-green');
  });

  test('texts queue behind the job in hand; the ones on a pulled line are dropped too', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const a = send(w, t, 'make the sign red');
    const b = send(w, t, 'closed');
    const c = send(w, t, 'put a boat in the window');
    expect(lineView(w).waiting).toBe(2);
    expect(answer(t, a).e.type).toBe('line.reply');
    // the second is in hand now; pull the plug and put it back in the same jack: the line was dropped
    expect(untilPatch(w, t, 'drawer')).toBe(true);
    plug(w, t, 'jack-storefront');
    expect(answer(t, b).e).toMatchObject({ type: 'line.refused', reason: 'cancelled' });
    expect(answer(t, c).e).toMatchObject({ type: 'line.refused', reason: 'cancelled' });
    expect(shopView(w)).toMatchObject({ sign: 'cable-red', open: true, picture: 'mountains' });
  });
});

describe('the switchboard', () => {
  test('a capped jack refuses the plug with a slip; the plug goes home', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const ev = plug(w, t, 'jack-reserved-1');
    expect(ev).toContainEqual({ type: 'card', by: 'cord', content: 'slip.reserved' });
    expect(w.setting('cord', 'jack')).toBe('jack-storefront');
    expect(w.undoStack()).toEqual([]);
    expect(lineView(w).line).toBe('storefront');
  });

  test('the station on a line answers the moment the plug seats; while the plug is held the live jacks offer themselves', async () => {
    const w = await benchWorld();
    const t = tape(w);
    w.dispatch({ type: 'unplug', cord: 'cord' });
    t.run(1);
    expect(lineView(w).line).toBeNull();
    expect(lineView(w).offering).toEqual(['jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp']);
    w.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-platen' });
    const ev = t.run(1);
    expect(ev).toContainEqual({ type: 'jack.answered', jack: 'jack-platen', station: 'platen' });
    expect(lineView(w).offering).toEqual([]);
    expect(platenView(w).answered).toBeLessThan(0.1);
    expect(shopView(w).answered).toBe(Infinity);
    for (const [jack, station] of [['jack-belt', 'belt'], ['jack-lamp', 'lamp'], ['jack-storefront', 'storefront']] as const) {
      expect(plug(w, t, jack)).toContainEqual({ type: 'jack.answered', jack, station });
    }
    expect(shopView(w).answered).toBeLessThan(0.1);
  });

  test('a text cannot be sent while the plug is out of its jack', async () => {
    const w = await benchWorld();
    const t = tape(w);
    w.dispatch({ type: 'unplug', cord: 'cord' });
    t.run(1);
    w.dispatch({ type: 'text', text: 'make it red' });
    t.run(1);
    expect(t.of('line.sent')).toEqual([]);
  });
});

describe('every jack answers "undo that", "help" and "who are you"', () => {
  test.each(['jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp'])('%s', async (jack) => {
    const w = await benchWorld();
    const t = tape(w);
    if (jack !== 'jack-storefront') plug(w, t, jack);
    const name = jack.slice(5);
    const help = textAndWait(w, t, 'help');
    expect(help.e.type).toBe('line.reply');
    expect(help.e.reply.map((l) => l.id)).toEqual([`help.${name}`, 'help.undo']);
    expect(help.seconds).toBeLessThan(0.1); // answered at once
    const who = textAndWait(w, t, 'Who are you?');
    expect(who.words).toBe('CLAUDE, WEARING A NAME TAG THAT SAYS PATCH.');
    const undo = textAndWait(w, t, 'undo that');
    expect(undo.words).toBe('Nothing to undo.');
  });
});

describe('what cannot be parsed is for Taylor: the mailbox flag goes up, nothing is sent', () => {
  test('an unparsed text', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const a = textAndWait(w, t, 'can taylor build me an app');
    expect(a.e).toMatchObject({ type: 'line.refused', reason: 'mailbox', mailbox: true });
    expect(a.words).toBe("That one's for Taylor. His mailbox is over there.");
    expect(t.of('mailbox.flag').map((x) => x.e.n)).toEqual([a.n]);
    expect(lineView(w).mailbox).toBeLessThan(0.1);
    expect(w.undoStack()).toEqual([]);
  });

  test('part of a text: the change is made, the rest goes to the mailbox', async () => {
    const w = await benchWorld();
    const t = tape(w);
    const a = textAndWait(w, t, 'make the sign red and email my accountant');
    expect(a.e).toMatchObject({ type: 'line.reply', mailbox: true });
    expect(a.words).toBe("Sign's red. I checked. Patched. That one's for Taylor. His mailbox is over there.");
    expect(t.of('mailbox.flag').length).toBe(1);
  });
});
