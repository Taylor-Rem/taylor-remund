// P4 S6 round two: the opening stand's two station candidates (kit/pieces/opening-stand/station.ts): inside 2,500
// triangles each; their bones (`yaw`, `upper`, `fore`, `tip`; 2's `lit`); what moves in at most two material classes.
import { describe, expect, it } from 'vitest';
import { standStation } from '../../../src/workshop/view/kit/pieces/opening-stand/station.ts';
import * as K from '../../../src/workshop/view/kit/index.ts';

const BUDGET = 2500;
type N = { name?: string; parts?: { material: string }[]; children?: unknown[] };
const names = (n: N, out: string[] = []): string[] => {
  if (n.name) out.push(n.name);
  for (const c of n.children ?? []) names(c as N, out);
  return out;
};
const classes = (n: N, under: boolean, out: Set<string>): Set<string> => {
  const here = under || n.name === 'yaw';
  if (here) for (const p of n.parts ?? []) out.add(p.material);
  for (const c of n.children ?? []) classes(c as N, here, out);
  return out;
};

describe.each([1, 2] as const)('the opening stand, candidate %s', (look) => {
  it('stays inside its triangle budget', () => {
    const p = standStation({ look });
    if (process.env['STAND_TRIS']) console.warn(K.budget(p, BUDGET).text);
    expect(p.triangles).toBeLessThanOrEqual(BUDGET);
  });
  it('has the arm bones, and what moves draws in at most two classes', () => {
    const p = standStation({ look });
    const n = names(p.root as N);
    for (const b of ['yaw', 'upper', 'fore', 'tip', ...(look === 2 ? ['lit'] : [])]) expect(n).toContain(b);
    expect([...classes(p.root as N, false, new Set())].length).toBeLessThanOrEqual(2);
  });
});
