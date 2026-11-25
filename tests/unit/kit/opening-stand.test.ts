// P4 S6 (I2: the placeholder that ships, the pedestal alone): the opening stand's piece inside its triangle budget at the
// station's size and at the table's (`?stand=c`), nothing of it that moves (no arm, no lamp), a `label` socket.
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
  it('stays inside its triangle budget, at the station\'s size and at the table\'s', () => {
    for (const [h, half] of [[0.5, [0.78, 0.72]], [0.22, [0.52, 0.48]]] as const) {
      const p = openingStand({ h, half });
      if (process.env['STAND_TRIS']) console.warn(K.budget(p, BUDGET).text, `h ${h}: ${p.triangles} triangles, low ${openingStand({ h, half, detail: 'low' }).triangles}`);
      expect(p.triangles).toBeLessThanOrEqual(BUDGET);
    }
  });
  it('has no arm and no lamp (nothing that moves) and a socket for a label', () => {
    const p = openingStand();
    const n = names(p.root as never);
    for (const gone of ['lifter', 'yaw', 'upper', 'fore', 'tip', 'lit']) expect(n).not.toContain(gone);
    expect(p.sockets?.['label']).toBeDefined();
  });
});
