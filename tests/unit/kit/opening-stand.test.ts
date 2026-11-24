// P4 S6: the opening stand's piece: inside its triangle budget at both heights, a `lifter` node, a `label` socket.
import { describe, expect, it } from 'vitest';
import { openingStand } from '../../../src/workshop/view/kit/pieces/opening-stand/index.ts';
import * as K from '../../../src/workshop/view/kit/index.ts';

const BUDGET = 1500;
const names = (n: { name?: string; children?: unknown[] }, out: string[] = []): string[] => {
  if (n.name) out.push(n.name);
  for (const c of n.children ?? []) names(c as typeof n, out);
  return out;
};

describe('the opening stand (kit piece)', () => {
  it('stays inside its triangle budget, on the bench and on the console', () => {
    for (const h of [0.22, 0.08]) {
      const p = openingStand({ h });
      if (process.env['STAND_TRIS']) console.warn(K.budget(p, BUDGET).text, `h ${h}: ${p.triangles} triangles, low ${openingStand({ h, detail: 'low' }).triangles}`);
      expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    }
  });
  it('has a lifter that moves and a socket for a label', () => {
    const p = openingStand();
    expect(names(p.root as never)).toContain('lifter');
    expect(p.sockets?.['label']).toBeDefined();
  });
});
