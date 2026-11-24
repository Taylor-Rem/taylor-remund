// P4 T2: the simulation's table of the tool wall (sim/scenes/bench.ts TOOLWALL) against the kit that draws it: each
// tool's body is the kit tool's bounds, and where it hangs is where the board (view/bench.ts LAYOUT) and the kit's
// `hangOf` put it; the board's body is the board; eight tools, two rows of three and a row of two with the sheet.
import { describe, expect, test } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { TOOL_KINDS, tool, hangOf, BOARD, SHEET, CANDIDATES, toolShape } from '../../../src/workshop/view/kit/pieces/toolwall/index.ts';
import type { Candidate, ToolKind } from '../../../src/workshop/view/kit/pieces/toolwall/index.ts';
import { pieceBounds } from '../../../src/workshop/view/kit/compose.ts';
import { LAYOUT } from '../../../src/workshop/view/bench.ts';
import { TOOLWALL, toolId, bench } from '../../../src/workshop/sim/scenes/bench.ts';

const S = LAYOUT.stations.toolwall;
/** The set stands the board's back on the wall (view/stations/set.ts `wallStand`): the frame starts at its z 0. */
const WALL = new Matrix4().makeTranslation(S.x, S.y, -5 + 0.012);

describe('the tool wall: the simulation and the kit agree', () => {
  test('every tool: its body is the kit tool, and it hangs where the board and its peg put it', () => {
    expect(Object.keys(TOOLWALL.tools).sort()).toEqual([...TOOL_KINDS].sort());
    for (const k of TOOL_KINDS) {
      const t = TOOLWALL.tools[k]!;
      const b = pieceBounds(tool(k));
      const c = b.getCenter(new Vector3());
      const h = b.getSize(new Vector3()).multiplyScalar(0.5);
      expect(Math.max(Math.abs(t.half[0] - h.x), Math.abs(t.half[1] - h.y), Math.abs(t.half[2] - h.z)), `${k} half`).toBeLessThan(2e-3);
      const m = WALL.clone().multiply(hangOf(k).matrix);
      const w = c.clone().applyMatrix4(m);
      expect(new Vector3(...t.at).distanceTo(w), `${k} hangs at`).toBeLessThan(3e-3);
      const q = new Quaternion().setFromRotationMatrix(m);
      expect(q.angleTo(new Quaternion(...t.q)), `${k} turn`).toBeLessThan(1e-3);
      // the part starts there, on the wall
      const p = bench.parts.find((x) => x.id === toolId(k))!;
      expect(p.stowedIn).toBe(TOOLWALL.unit);
      expect(p.kind).toBe('tool');
    }
  });

  test('the board\'s body is the board: its face where the kit\'s is, its frame round it', () => {
    const b = TOOLWALL.board;
    expect(b.c[0]).toBeCloseTo(S.x, 3);
    expect(b.c[2] + b.half[2]).toBeCloseTo(-5 + 0.012 + BOARD.face, 2);
    expect(b.c[1] - b.half[1]).toBeGreaterThan(1.344); // above Revert's height (sim/crew/revert.ts reads a static under it as in its way)
    expect(b.c[1] - b.half[1]).toBeLessThan(1.5);
    expect(b.c[1] + b.half[1]).toBeGreaterThan(S.y + BOARD.y0 + BOARD.h);
  });

  test('each tool hangs in front of the board and clear of every other tool; the sheet is clear of them all', () => {
    const boxes = TOOL_KINDS.map((k) => {
      const t = TOOLWALL.tools[k]!;
      const a = 2 * Math.atan2(t.q[2], t.q[3]);
      const hx = Math.abs(Math.cos(a)) * t.half[0] + Math.abs(Math.sin(a)) * t.half[1];
      const hy = Math.abs(Math.sin(a)) * t.half[0] + Math.abs(Math.cos(a)) * t.half[1];
      return { k, x0: t.at[0] - hx, x1: t.at[0] + hx, y0: t.at[1] - hy, y1: t.at[1] + hy, back: t.at[2] - t.half[2] };
    });
    for (const b of boxes) expect(b.back, b.k).toBeGreaterThan(TOOLWALL.board.c[2] + TOOLWALL.board.half[2] - 0.001);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `${a.k} and ${b.k}`).toBe(false);
      }
    const sx = S.x + SHEET.x, sy = S.y + SHEET.y;
    for (const b of boxes) expect(sx - SHEET.w / 2 > b.x1 || sx + SHEET.w / 2 < b.x0 || sy - SHEET.h / 2 > b.y1 || sy + SHEET.h / 2 < b.y0, `sheet and ${b.k}`).toBe(true);
    // and everything on the board, inside its frame
    const right = S.x + BOARD.w / 2, left = S.x - BOARD.w / 2, top = S.y + BOARD.y0 + BOARD.h;
    for (const b of boxes) expect(b.x0 > left && b.x1 < right && b.y1 < top, `${b.k} on the board`).toBe(true);
  });

  test('the new tools\' candidates each build, with a peg and a painted shadow', () => {
    for (const [k, cs] of Object.entries(CANDIDATES) as Array<[ToolKind, readonly Candidate[]]>)
      for (const c of cs) {
        const p = tool(k, { candidate: c });
        expect(p.triangles, `${k} ${c}`).toBeGreaterThan(300);
        expect(p.triangles, `${k} ${c}`).toBeLessThan(3200);
        expect(toolShape(k, c).pegs.length).toBeGreaterThan(0);
        expect(toolShape(k, c).shadow.length).toBeGreaterThan(0);
      }
  });
});
