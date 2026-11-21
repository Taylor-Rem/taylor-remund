// The playtest log's figures (P3 B3; REWRITE.md § I): § I's thresholds computed from a recorded sequence.
import { describe, expect, it } from 'vitest';
import { logFile, STALL_MS, thresholds, type Row } from '../../../src/workshop/ui/playtest/log.ts';

const page: Row = { t: 5, kind: 'page', tier: 'high', why: 'capable', viewport: { w: 390, h: 844, dpr: 3 }, motion: { setting: 'system', system: false, reduced: false }, sound: true };

/** A tester: the picture at 0.6 s, usable at 3.1 s; presses the Button at 9 s (it misfires the belt); drops a crate on the belt at 30 s (belt, striker, dock act); turns the dial at 140 s; presses Résumé at 170 s. */
const rows: Row[] = [
  page,
  { t: 600, kind: 'picture' },
  { t: 3100, kind: 'usable' },
  { t: 9000, kind: 'action', seq: 1, verb: 'press', input: 'touch', id: 'button' },
  { t: 9020, kind: 'consequence', event: 'button.pressed', machine: 'button', rung: 1, cause: 1 },
  { t: 9100, kind: 'consequence', event: 'misfire', machine: 'belt', cause: 1 },
  { t: 9200, kind: 'first-use', station: 'button', cause: 1 },
  { t: 30_000, kind: 'action', seq: 2, verb: 'pick-up', input: 'touch', id: 'crate-4' },
  { t: 31_000, kind: 'action', seq: 3, verb: 'put-down', input: 'touch', id: 'crate-4', speed: 0.2 },
  { t: 31_500, kind: 'consequence', event: 'taken-in', machine: 'belt', part: 'crate-4', cause: 3 },
  { t: 34_000, kind: 'consequence', event: 'struck', machine: 'striker', part: 'crate-4', cause: 3 },
  { t: 36_000, kind: 'consequence', event: 'shipped', machine: 'dock', part: 'crate-4', cause: 3 },
  { t: 36_100, kind: 'first-use', station: 'line', cause: 3 },
  { t: 140_000, kind: 'action', seq: 4, verb: 'turn', input: 'mouse', id: 'belt-dial', value: 1 },
  { t: 140_100, kind: 'consequence', event: 'effect', machine: 'belt', id: 'belt', field: 'speed', cause: 4 },
  { t: 170_000, kind: 'strip', control: 'resume' },
];
const inputs = [9000, 30_000, 31_000, 140_000, 170_000];

describe('thresholds (§ I), from the log', () => {
  const th = thresholds({ rows, inputs, end: 175_000 });

  it('when the picture showed, when the bench was usable, the first deliberate action', () => {
    expect(th.pictureAt).toBe(600);
    expect(th.usableAt).toBe(3100);
    expect(th.firstAction).toEqual({ at: 9000, afterPicture: 8400, afterUsable: 5900, verb: 'press', id: 'button', input: 'touch' });
  });

  it('different things and stations used in the first 2 minutes (from the picture)', () => {
    expect(th.thingsInFirst2Min).toEqual({ count: 2, ids: ['button', 'crate-4'] });
    expect(th.stationsInFirst2Min).toEqual({ count: 2, ids: ['button', 'line'] });
  });

  it('a chain: one action after which two or more machines acted (the press: Button and belt; the crate: belt, striker, dock)', () => {
    expect(th.chain.reached).toBe(true);
    expect(th.chain.firstAt).toBe(9000);
    expect(th.chain.actions.map((a) => [a.seq, a.machines])).toEqual([
      [1, ['button', 'belt']],
      [3, ['belt', 'striker', 'dock']],
    ]);
  });

  it('carried on past 2 minutes; stalls of more than 15 s once usable, the end of the log closing the last', () => {
    expect(th.pastTwoMinutes).toEqual({ actionsAfter: 1, lastActionAt: 140_000 });
    expect(th.stalls).toEqual([
      { from: 9000, to: 30_000, ms: 21_000 },
      { from: 31_000, to: 140_000, ms: 109_000 },
      { from: 140_000, to: 170_000, ms: 30_000 },
    ]);
    expect(th.stalls.every((g) => g.ms > STALL_MS)).toBe(true);
  });

  it('the résumé, the presses on the Button, and what only the tester can say', () => {
    expect(th.resumeAt).toEqual([170_000]);
    expect(th.buttonPresses).toBe(1);
    expect(th.whoseSite).toBe('ask the tester');
  });

  it('a log with no action and no picture: figures that say so, not errors', () => {
    const t = thresholds({ rows: [page], inputs: [], end: 1000 });
    expect(t.firstAction).toBeNull();
    expect(t.chain).toEqual({ reached: false, firstAt: null, actions: [] });
    expect(t.stalls).toEqual([]);
    expect(t.from).toBe(5);
  });

  it('a consequence of the crew (no cause) makes no chain', () => {
    const t = thresholds({ rows: [page, { t: 10, kind: 'action', seq: 1, verb: 'press', input: 'keys', id: 'belt-lever' }, { t: 20, kind: 'consequence', event: 'shipped', machine: 'dock', cause: null }, { t: 21, kind: 'consequence', event: 'effect', machine: 'belt', cause: 1 }], inputs: [10], end: 30 });
    expect(t.chain.reached).toBe(false);
  });
});

describe('the file', () => {
  it('the figures first, then the context, then every row in time order; parseable', () => {
    const shuffled = [rows[0]!, rows[3]!, rows[1]!, rows[2]!];
    const text = logFile({ rows: shuffled, inputs, end: 10_000 }, { address: '/?playtest=1' });
    const f = JSON.parse(text) as Record<string, unknown> & { rows: Row[] };
    expect(Object.keys(f)).toEqual(['log', 'version', 'thresholds', 'context', 'rows']);
    expect(f.rows.map((r) => r.t)).toEqual([5, 600, 3100, 9000]);
  });
});
