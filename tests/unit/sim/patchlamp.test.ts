// The Patchlamp station's pure pieces (S3): the lamp arm's reach, the all-or-nothing rule-7 check, the
// cord's live and capped jacks, and the scene's numbers.
import { describe, expect, it } from 'vitest';
import { insidePolygon, reachable } from '../../../src/workshop/sim/machines/lamp.ts';
import type { LampSpec } from '../../../src/workshop/sim/machines/lamp.ts';
import { newerWriter } from '../../../src/workshop/sim/machines/shared/patchlamp.ts';
import { isLiveJack } from '../../../src/workshop/sim/machines/cord.ts';
import { PATCHLAMP, bench } from '../../../src/workshop/sim/scenes/bench.ts';
import type { SimContext } from '../../../src/workshop/sim/context.ts';
import type { Writer } from '../../../src/workshop/sim/types.ts';

const SPEC: LampSpec = { id: 'lamp', station: 'top', name: 'name.lamp', levels: 5, startLevel: 3, home: PATCHLAMP.lamp.home, reach: PATCHLAMP.lamp.reach };

describe('the lamp arm: what its joints allow', () => {
  it('home is reachable as it is', () => {
    const [x, z] = reachable(SPEC, SPEC.home.aim[0], SPEC.home.aim[2]);
    expect(x).toBeCloseTo(SPEC.home.aim[0], 2);
    expect(z).toBeCloseTo(SPEC.home.aim[2], 2);
  });

  it('anywhere the hand goes, the aim stays inside the reachable region (to the grid), and inside it is left where it is', () => {
    const poly = SPEC.reach.polygon;
    for (let i = 0; i < 400; i++) {
      const tx = -20 + (i % 20) * 2;
      const tz = -20 + Math.floor(i / 20) * 2;
      const [x, z] = reachable(SPEC, tx, tz);
      // inside, or on an edge to within the grid
      const ring = Array.from({ length: 16 }, (_, k) => [0.008 * Math.cos((k * Math.PI) / 8), 0.008 * Math.sin((k * Math.PI) / 8)] as const);
      const inside = insidePolygon(poly, x, z) || ring.some(([dx, dz]) => insidePolygon(poly, x + dx, z + dz));
      expect(inside, `${tx}, ${tz} -> ${x}, ${z}`).toBe(true);
      if (insidePolygon(poly, tx, tz)) expect([x, z]).toEqual([tx, tz]);
    }
  });
});

describe('rule 7 before committing: a station does all of a text or none of it', () => {
  const ctx = (writers: Record<string, Writer>): SimContext => ({ writer: (t: string, f: string) => writers[`${t}.${f}`] }) as unknown as SimContext;
  it('refuses when any field was written by a newer transaction', () => {
    const c = ctx({ 'shop.sign': 't3', 'shop.open': 't7' });
    expect(newerWriter(c, 't5', [{ target: 'shop', field: 'sign' }])).toBe(false);
    expect(newerWriter(c, 't5', [{ target: 'shop', field: 'sign' }, { target: 'shop', field: 'open' }])).toBe(true);
  });
  it('the crew, the system and settled values never refuse a text', () => {
    const c = ctx({ 'shop.sign': 'crew', 'shop.open': 'settled', 'shop.picture': 'system' });
    expect(newerWriter(c, 't1', [{ target: 'shop', field: 'sign' }, { target: 'shop', field: 'open' }, { target: 'shop', field: 'picture' }])).toBe(false);
    expect(newerWriter(c, 'system', [{ target: 'shop', field: 'sign' }])).toBe(false);
  });
});

describe('the switchboard in the bench scene', () => {
  it('has four live lines and two capped jacks, left to right', () => {
    expect(bench.cord.jacks.map((j) => j.id)).toEqual(['jack-reserved-1', 'jack-reserved-2', 'jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp']);
    expect(bench.cord.jacks.filter((j) => isLiveJack(j.id)).map((j) => j.id)).toEqual(['jack-storefront', 'jack-platen', 'jack-belt', 'jack-lamp']);
    const xs = bench.cord.jacks.map((j) => j.at[0]);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('the platen tray is a mouth over its seat; Patch sits on the stool', () => {
    const m = bench.mouths!.find((x) => x.id === 'platen')!;
    expect(m).toMatchObject({ machine: 'platen', station: 'patchlamp', drop: PATCHLAMP.seat });
    expect(PATCHLAMP.patch.seat[1]).toBeGreaterThan(0.6); // the stool lowered for the whole board (STOOL_SEAT 0.62 over the runner)
  });
});
