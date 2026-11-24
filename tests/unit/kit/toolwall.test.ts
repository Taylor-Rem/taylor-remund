import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, Vector3 } from 'three';
import type { Material } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { toolwall, tool, toolShape, hangOf, catalogue, estimateTape, toolName, tapeLines, BOARD, SHEET, TOOL_KINDS, TOOL_PAINT } from '../../../src/workshop/view/kit/pieces/toolwall/index.ts';
import { world } from '../../../src/workshop/view/labels/content.ts';
import { checkGeometry } from './helpers.ts';

// P4 T2: eight tools and a board a row taller (5.8 high, a third more holes), and the pinned sheet: 11,456 measured. On the
// bench the board is in the set (built without its tools, `tools: false`: 4,795) and the eight tools are one rig.
const WALL_BUDGET = 12000;
const BOARD_BUDGET = 5000;
const TOOL_BUDGET = 1200; // a tool about 800; the pliers run to ~1,100, the cranked drill ~1,150

const stub: Materials = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial(), update() {}, dispose() {} };

function colourOf(n: PieceNode, material: string): Set<string> {
  const out = new Set<string>();
  for (const q of n.parts) {
    if (q.material !== material) continue;
    const c = q.geometry.getAttribute('color');
    for (let i = 0; i < c.count; i += 7) out.add(`${c.getX(i).toFixed(3)},${c.getY(i).toFixed(3)},${c.getZ(i).toFixed(3)}`);
  }
  return out;
}

describe('the tool wall', () => {
  const p = toolwall();

  it('builds deterministically', () => {
    expect(toolwall({ seed: 2 }).triangles).toBe(toolwall({ seed: 2 }).triangles);
  });

  it('stays inside its budget with all eight tools, and without them, and each tool inside its own', () => {
    const b = K.budget(p, WALL_BUDGET);
    expect(b.fits, b.text).toBe(true);
    const bare = K.budget(toolwall({ tools: false }), BOARD_BUDGET);
    expect(bare.fits, bare.text).toBe(true);
    for (const k of TOOL_KINDS) {
      const t = K.budget(tool(k), TOOL_BUDGET);
      expect(t.fits, t.text).toBe(true);
    }
  });

  it('hangs each tool on a node over a socket, its pegs in holes', () => {
    const names = new Set<string>();
    const walk = (n: PieceNode): void => { names.add(n.name); for (const c of n.children ?? []) walk(c); };
    walk(p.root);
    for (const k of TOOL_KINDS) {
      expect(names.has(`tool.${k}`), k).toBe(true);
      expect(p.sockets![`hang.${k}`]).toBeDefined();
      for (const [x, y] of hangOf(k).pegs) {
        const i = (x + BOARD.w / 2 - BOARD.pitch / 2) / BOARD.pitch, j = (y - BOARD.y0 - BOARD.pitch / 2) / BOARD.pitch;
        expect(Math.abs(i - Math.round(i)), `${k} peg x`).toBeLessThan(1e-6);
        expect(Math.abs(j - Math.round(j)), `${k} peg y`).toBeLessThan(1e-6);
        expect(Math.abs(x)).toBeLessThan(BOARD.w / 2);
      }
    }
    expect(toolwall({ tools: false }).root.children ?? []).toHaveLength(0);
  });

  it('tools stay on the board and clear of each other', () => {
    const boxes = TOOL_KINDS.map((k) => {
      const b = K.pieceBounds(tool(k));
      return b.applyMatrix4(hangOf(k).matrix);
    });
    boxes.forEach((b, i) => {
      expect(b.min.x).toBeGreaterThan(-BOARD.w / 2);
      expect(b.max.x).toBeLessThan(BOARD.w / 2);
      expect(b.min.y).toBeGreaterThan(BOARD.y0);
      expect(b.max.y).toBeLessThan(BOARD.y0 + BOARD.h);
      expect(b.min.z).toBeGreaterThan(BOARD.face);
      boxes.forEach((c, j) => { if (j > i) expect(b.intersectsBox(c), `${TOOL_KINDS[i]} / ${TOOL_KINDS[j]}`).toBe(false); });
    });
  });

  it('takes its names from the content, at the tape default size', () => {
    expect(TOOL_KINDS.map(toolName)).toEqual([world.tools.laravel, world.tools.vue, world.tools.php, world.tools.python, world.tools.rust, world.tools.sql, world.tools.flutter, world.tools['claude-code']]);
    // the board carries the widest row of tapes (CLAUDE CODE on two strips, one word each, and the sheet beside them)
    const rowW = (ks: readonly string[]): number => ks.reduce((s, k) => s + Math.max(...tapeLines(k as never).map((l) => estimateTape(l).w)), 0);
    expect(rowW(['laravel', 'vue', 'php'])).toBeLessThan(BOARD.w);
    expect(rowW(['python', 'rust', 'sql'])).toBeLessThan(BOARD.w);
    expect(rowW(['flutter', 'claude-code']) + SHEET.w).toBeLessThan(BOARD.w);
  });

  it('every geometry holds the kit invariants', () => {
    const walk = (nd: PieceNode): void => {
      for (const q of nd.parts) checkGeometry(q.geometry);
      for (const c of nd.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('is registered with a labels hook, and realizes', () => {
    const e = catalogue.find((c) => c.name === 'toolwall')!;
    expect(typeof e.labels).toBe('function');
    const o = K.realize(e.build(), stub);
    expect(o.getObjectByName('tool.php')).toBeDefined();
    for (const k of TOOL_KINDS) expect(catalogue.some((c) => c.name === `tool-${k}`)).toBe(true);
  });
});

describe('the tools', () => {
  for (const k of TOOL_KINDS) {
    it(`${k}: a box-collider size, a peg socket, its handle paint`, () => {
      const t = tool(k);
      expect(t.size.y).toBeGreaterThan(0.9);
      expect(t.size.y).toBeLessThan(1.3);
      expect(t.size.x).toBeLessThan(0.8);
      expect(t.size.z).toBeLessThan(0.25);
      const peg = new Vector3().setFromMatrixPosition(t.sockets!['peg']!);
      expect(peg.toArray()).toEqual([...toolShape(k).pegs[0]!, 0]);
      // the handle paint is there, in its own colour
      const painted = new Set([...colourOf(t.root, 'wood'), ...colourOf(t.root, 'steel')]);
      expect(painted.size).toBeGreaterThan(0);
      expect(TOOL_PAINT[k]).toBeDefined();
      expect(K.pieceBounds(t).min.y).toBeGreaterThan(-0.02);
      for (const q of t.root.parts) checkGeometry(q.geometry);
    });
  }
});
