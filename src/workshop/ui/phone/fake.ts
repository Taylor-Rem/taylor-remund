/**
 * A scripted stand-in for the Patchlamp station's phone line, for the dev
 * page and the tests, until the station implements `PhoneLine` itself. It
 * answers with the real parser (sim/instruct `parse`) after a short,
 * fixed delay; it changes nothing in any world. Time comes from the
 * `after` it is given, so a test can step it.
 */
import { parse } from '../../sim/instruct/index.ts';
import world from '../../../content/world.json';
import type { Jack, PhoneEvent, PhoneLine } from './types.ts';

export interface FakeLineOptions {
  /** Where the cord is at the start. Default `storefront`. */
  jack?: Jack | null;
  /** Begin with the attract-mode exchange (Fetch texted the platen line). Default true. */
  attract?: boolean;
  /** Milliseconds from sent to working, and from working to the answer. */
  pickUp?: number;
  work?: number;
  /** The scheduler (default setTimeout). */
  after?: (ms: number, fn: () => void) => void;
}

export interface FakeLine extends PhoneLine {
  /** Move the cord (what dragging the plug does). */
  plug(jack: Jack | null): void;
  /** Put a finished exchange in the log at once (dev page set-ups). */
  exchange(text: string, jack?: Jack): void;
}

export function fakeLine(o: FakeLineOptions = {}): FakeLine {
  const after = o.after ?? ((ms: number, fn: () => void) => void setTimeout(fn, ms));
  const pickUp = o.pickUp ?? 450;
  const work = o.work ?? 1500;
  const events: PhoneEvent[] = [];
  const listeners = new Set<(e: PhoneEvent) => void>();
  let jack: Jack | null = o.jack === undefined ? 'storefront' : o.jack;
  let next = 1;
  // one job at a time, in the order sent
  const queue: { id: number; text: string; on: Jack }[] = [];
  let busy = false;
  const runNext = (): void => {
    const job = queue.shift();
    busy = job !== undefined;
    if (!job) return;
    after(pickUp, () => {
      emit({ type: 'working', id: job.id });
      after(work, () => {
        emit(answer(job.id, job.text, job.on));
        runNext();
      });
    });
  };

  const emit = (e: PhoneEvent): void => {
    events.push(e);
    for (const l of listeners) l(e);
  };
  const answer = (id: number, text: string, on: Jack): PhoneEvent => {
    const p = parse(text, on);
    return p.kind === 'refusal'
      ? { type: 'refused', id, reason: p.reason, reply: p.reply, mailbox: p.mailbox }
      : { type: 'reply', id, reply: p.reply, mailbox: p.mailbox };
  };
  const exchange = (text: string, on: Jack = jack ?? 'storefront'): void => {
    const id = next++;
    emit({ type: 'sent', id, jack: on, text });
    emit({ type: 'working', id });
    emit(answer(id, text, on));
  };

  if (o.attract !== false) for (const m of world.phone.attract) exchange(m.text, 'platen');

  return {
    get jack() {
      return jack;
    },
    log: () => events.slice(),
    send(text: string) {
      if (jack === null) return;
      const id = next++;
      emit({ type: 'sent', id, jack, text });
      queue.push({ id, text, on: jack });
      if (!busy) runNext();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    plug(j) {
      if (j === jack) return;
      jack = j;
      emit({ type: 'jack', jack: j });
    },
    exchange,
  };
}
