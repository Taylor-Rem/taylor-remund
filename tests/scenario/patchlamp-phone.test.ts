// The phone line over the world (S3: src/workshop/ui/phone/world-line.ts): the `PhoneLine` the phone
// panel reads, made from the world's view and intents, on the whole bench under real Rapier.
import { describe, expect, test } from 'vitest';
import { benchWorld, tape } from './line-helpers.ts';
import type { Tape } from './line-helpers.ts';
import { worldLine } from '../../src/workshop/ui/phone/world-line.ts';
import type { WorldLine } from '../../src/workshop/ui/phone/world-line.ts';
import type { PhoneEvent } from '../../src/workshop/ui/phone/types.ts';
import { replay } from '../../src/workshop/ui/phone/model.ts';
import { renderReply } from '../../src/content/texts.ts';
import type { World } from '../../src/workshop/sim/world.ts';
import { HZ } from '../../src/workshop/sim/clock.ts';

/** Step the world and sync the phone once per step (as a frame would). */
function frames(t: Tape, line: WorldLine, n: number): void {
  for (let i = 0; i < n; i++) {
    t.run(1);
    line.sync();
  }
}

async function setUp(): Promise<{ w: World; t: Tape; line: WorldLine; heard: PhoneEvent[] }> {
  const w = await benchWorld();
  const t = tape(w);
  const line = worldLine({ world: w, dispatch: (i) => w.dispatch(i) });
  const heard: PhoneEvent[] = [];
  line.subscribe((e) => heard.push(e));
  return { w, t, line, heard };
}

describe('the phone line over the world', () => {
  test('the log begins with the attract exchange; a text is sent, worked and answered; ids follow on', async () => {
    const { t, line, heard } = await setUp();
    expect(line.jack).toBe('storefront');
    expect(line.log()).toEqual([
      { type: 'sent', id: 1, jack: 'platen', text: 'Make it blue.' },
      { type: 'working', id: 1 },
      { type: 'reply', id: 1, reply: [{ id: 'change.platen.colour', colour: 'paint-blue' }, { id: 'done.checked' }, { id: 'done.patched' }], mailbox: false },
    ]);
    line.send('make the sign red');
    frames(t, line, 1);
    expect(heard[0]).toEqual({ type: 'sent', id: 2, jack: 'storefront', text: 'make the sign red' }); // (Patch is free: it is on it in the same step)
    frames(t, line, 4 * HZ);
    expect(heard.map((e) => e.type)).toEqual(['sent', 'working', 'reply']);
    const reply = heard[2] as Extract<PhoneEvent, { type: 'reply' }>;
    expect(renderReply(reply.reply)).toBe("Sign's red. I checked. Patched.");
    // the panel's model reads the same log
    const state = replay(line.jack, line.log());
    expect(state.items.filter((i) => i.kind === 'answer').length).toBe(2);
  });

  test('the cord moves: the phone hears the jack go out and come back on another line', async () => {
    const { w, t, line, heard } = await setUp();
    w.dispatch({ type: 'unplug', cord: 'cord' });
    frames(t, line, 1);
    expect(line.jack).toBeNull();
    w.dispatch({ type: 'plug', cord: 'cord', jack: 'jack-belt' });
    frames(t, line, 1);
    expect(line.jack).toBe('belt');
    expect(heard).toEqual([
      { type: 'jack', jack: null },
      { type: 'jack', jack: 'belt' },
    ]);
    // nothing goes down a line that is out
    w.dispatch({ type: 'unplug', cord: 'cord' });
    frames(t, line, 1);
    line.send('faster');
    frames(t, line, 3);
    expect(heard.filter((e) => e.type === 'sent')).toEqual([]);
  });

  test('a text sent while a Button rung plays is held, and goes when the rung ends', async () => {
    const { w, t, line, heard } = await setUp();
    w.dispatch({ type: 'press', id: 'button' });
    frames(t, line, 2);
    expect(w.bracketed).toBe(true);
    line.send('make the awning blue');
    frames(t, line, 2);
    expect(heard.filter((e) => e.type === 'sent')).toEqual([]);
    for (let i = 0; i < 10 * HZ && w.bracketed; i++) frames(t, line, 1);
    frames(t, line, 2);
    expect(heard.filter((e) => e.type === 'sent')).toEqual([{ type: 'sent', id: 2, jack: 'storefront', text: 'make the awning blue' }]);
  });

  test('a refusal is answered at once, with no working', async () => {
    const { t, line, heard } = await setUp();
    line.send('make the lamp green');
    frames(t, line, 1);
    expect(heard.map((e) => e.type)).toEqual(['sent', 'refused']);
    expect(heard[1]).toMatchObject({ reason: 'outside' });
  });
});
