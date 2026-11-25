import { describe, expect, it } from 'vitest';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { backWall, bench, benchFrame, benchHole, catalogue as benchCatalogue, FLOOR_Y } from '../../../src/workshop/view/kit/pieces/bench/index.ts';
import { OPENING } from '../../../src/workshop/view/kit/pieces/revert-hatch/index.ts';
import { catalogue as roomCatalogue, floor, ROOM, roomEnd, roomWall } from '../../../src/workshop/view/kit/pieces/room/index.ts';
import { catalogue as windowCatalogue, SCENE, STEADY, WINDOW, windowHole, windowPiece } from '../../../src/workshop/view/kit/pieces/window/index.ts';
import { loadCatalogue } from '../../../src/workshop/view/kit/pieces/registry.ts';

const everyEntry = (await loadCatalogue()).filter((e) => e.name !== 'window');
import { checkGeometry } from './helpers.ts';

function parts(p: Piece): PieceNode['parts'] {
  const out: PieceNode['parts'] = [];
  const walk = (n: PieceNode): void => {
    out.push(...n.parts);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}
const classes = (p: Piece): Set<string> => new Set(parts(p).map((q) => q.material));
const nodeCount = (p: Piece): number => {
  let n = 0;
  const walk = (x: PieceNode): void => {
    n++;
    for (const c of x.children ?? []) walk(c);
  };
  walk(p.root);
  return n;
};

/** A hash of every position, colour and surf value: the vignette's bench and wall must not move by a hair. */
function hash(p: Piece): string {
  let h = 0;
  let n = 0;
  for (const q of parts(p)) {
    for (const name of ['position', 'color', 'surf']) {
      const a = q.geometry.getAttribute(name);
      for (let i = 0; i < a.array.length; i++) {
        h = (h * 31 + Math.round((a.array[i] as number) * 1e4)) | 0;
        n++;
      }
    }
  }
  return `${h}/${n}`;
}

const B = ROOM.bench;
const built = {
  wall: backWall(roomWall()),
  frame: benchFrame({ sections: B.sections, width: B.width, depth: B.depth }),
  floor: floor({ width: ROOM.floor.width, z0: ROOM.floor.z0, z1: ROOM.floor.z1 }),
  left: roomEnd({ side: 'left' }),
  right: roomEnd({ side: 'right' }),
  window: windowPiece(),
};

describe('the vignette', () => {
  // the wall: measured on rewrite at f3075ca, before the room's options existed (G1's approved frames)
  it('back wall builds exactly as it did at G1 with its old options', () => {
    expect(hash(backWall({ width: 21, height: 9 }))).toBe('-273831865/16938');
  });
  // the bench top changed once, on purpose: the P2 diet (11,133 to 4,306 triangles at the vignette's 3 x 6.5).
  // G1's was '-1036722999/72585'. The old/new frames are in the diet's hand-in; change this only with pictures.
  it('bench top builds as the P2 diet left it', () => {
    expect(hash(bench({ sections: 3, width: 6.5 }))).toBe('-955912666/39303');
  });
  it('the bench top at the bench page\'s 18 x 10 fits in 4,000 triangles', () => {
    expect(bench({ sections: 3, width: 6, depth: 10 }).triangles).toBeLessThanOrEqual(4000);
  });
});

describe('a hole through the bench top (Revert\'s hatch)', () => {
  const hole = benchHole(-3.6, 0.35, OPENING.w * 1.2, OPENING.d * 1.2);
  const plain = bench({ sections: 3, width: 6, depth: 10 });
  const holed = bench({ sections: 3, width: 6, depth: 10, openings: [hole] });

  it('costs little: the cut boards and nothing else', () => {
    // eslint-disable-next-line no-console
    console.log(`bench top 18 x 10: ${plain.triangles} plain, ${holed.triangles} with the hatch's hole (+${holed.triangles - plain.triangles})`);
    expect(holed.triangles - plain.triangles).toBeLessThan(400);
    expect(holed.triangles).toBeLessThanOrEqual(4200);
  });

  it('leaves the hole open: nothing of the top inside it, and its cut faces dark', () => {
    let dark = 0;
    for (const q of parts(holed)) {
      const pos = q.geometry.getAttribute('position'), sf = q.geometry.getAttribute('surf');
      q.geometry.computeBoundingBox();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const inside = x > hole.x0 + 1e-3 && x < hole.x1 - 1e-3 && z > hole.z0 + 1e-3 && z < hole.z1 - 1e-3;
        // the apron and the nose are not in the hole's rows; nothing at all may stand inside it
        if (inside) throw new Error(`inside the hole: ${q.material} at ${x.toFixed(3)}, ${pos.getY(i).toFixed(4)}, ${z.toFixed(3)}`);
        const onEdge = Math.abs(x - hole.x0) < 1e-4 || Math.abs(x - hole.x1) < 1e-4 || Math.abs(z - hole.z0) < 1e-4 || Math.abs(z - hole.z1) < 1e-4;
        if (onEdge && pos.getY(i) < -0.01 && sf.getY(i) === 1) dark++;
      }
    }
    expect(dark).toBeGreaterThan(8);
  });

  it('changes nothing without one', () => {
    expect(bench({ sections: 3, width: 6, depth: 10, openings: [] }).triangles).toBe(plain.triangles);
  });
});

describe('the room', () => {
  it('every piece is sound geometry', () => {
    for (const p of [built.wall, built.frame, built.floor, built.left, built.right]) {
      for (const q of parts(p)) checkGeometry(q.geometry);
    }
    // the window's scenery writes finish 2 (the bulb class's steady level): check it with that read as 1
    for (const q of parts(built.window)) {
      const g = q.geometry.clone();
      const sf = g.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) if (sf.getZ(i) === STEADY) sf.setZ(i, 1);
      checkGeometry(g);
    }
  });

  it('only the window\'s scenery is steady (finish above 1.5 on bulbs), and all of it is', () => {
    const bulbs = parts(built.window).filter((q) => q.material === 'bulb');
    expect(bulbs.length).toBeGreaterThan(0);
    for (const q of bulbs) {
      const sf = q.geometry.getAttribute('surf');
      for (let i = 0; i < sf.count; i++) expect(sf.getZ(i)).toBe(STEADY);
    }
    // every other piece in the catalogue keeps its bulbs at or under 1: the change to the bulb class cannot touch them
    for (const e of everyEntry) {
      for (const v of Object.values(e.variants ?? { d: {} })) {
        const p = e.build(v);
        for (const q of parts(p)) {
          if (q.material !== 'bulb') continue;
          const sf = q.geometry.getAttribute('surf');
          for (let i = 0; i < sf.count; i++) expect(sf.getZ(i)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('fits the triangle caps: window 3,000; structure, floor, wall and dressing 9,000 together', () => {
    expect(built.window.triangles).toBeLessThanOrEqual(3000);
    const rest = built.wall.triangles + built.frame.triangles + built.floor.triangles + built.left.triangles + built.right.triangles;
    expect(rest).toBeLessThanOrEqual(9000);
  });

  it('is static and cheap to draw: one node each, three material classes at most', () => {
    for (const p of [built.wall, built.frame, built.floor, built.left, built.right, built.window]) {
      expect(nodeCount(p)).toBe(1);
      expect(classes(p).size).toBeLessThanOrEqual(3);
    }
  });

  it('the wall runs on past the bench, down to the floor, with the window cut out of it', () => {
    const bb = K.pieceBounds(built.wall);
    expect(bb.min.x).toBeLessThan(-13);
    expect(bb.max.x).toBeGreaterThan(13);
    expect(bb.min.y).toBeCloseTo(FLOOR_Y, 2);
    const hole = windowHole(ROOM.window.x, ROOM.window.y);
    // nothing of the wall's face inside the hole
    for (const q of parts(built.wall)) {
      const pos = q.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const inside = x > hole.x0 + 1e-3 && x < hole.x1 - 1e-3 && y > hole.y0 + 1e-3 && y < hole.y1 - 1e-3;
        expect(inside).toBe(false);
      }
    }
  });

  it('the frame stands under the front edge, from the floor to the top, and nothing is built at the back', () => {
    const bb = K.pieceBounds(built.frame);
    expect(bb.min.y).toBeCloseTo(FLOOR_Y, 2);
    expect(bb.max.y).toBeLessThanOrEqual(-0.35);
    expect(bb.max.z).toBeLessThanOrEqual(B.depth / 2);
    expect(bb.min.z).toBeGreaterThan(B.depth / 2 - 1);
    expect(bb.min.x).toBeGreaterThan(-(B.sections * B.width) / 2);
    expect(bb.max.x).toBeLessThan((B.sections * B.width) / 2);
  });

  it('the dressing stays past the bench ends and against the wall', () => {
    const l = K.pieceBounds(built.left), r = K.pieceBounds(built.right);
    expect(l.max.x).toBeLessThan(0); // origin at the bench's end: all of it past the end
    expect(r.min.x).toBeGreaterThan(0);
    expect(l.max.z).toBeLessThan(3);
    expect(r.max.z).toBeLessThan(3);
  });

  it('the floor is a floor: flat, its top at its origin, cheap', () => {
    const bb = K.pieceBounds(built.floor);
    expect(bb.max.y).toBeLessThanOrEqual(1e-6);
    expect(bb.max.y - bb.min.y).toBeLessThan(0.25);
    expect(built.floor.triangles).toBeLessThan(1500);
  });

  it('the window: origin at the opening\'s bottom middle on the wall face, sill proud, scenery behind', () => {
    const bb = K.pieceBounds(built.window);
    expect(bb.max.z).toBeCloseTo(WINDOW.sillOut, 2);
    expect(bb.min.z).toBeLessThan(SCENE.far + 0.1);
    expect(bb.min.x).toBeLessThan(-WINDOW.w / 2);
    expect(bb.max.x).toBeGreaterThan(WINDOW.w / 2);
    expect(classes(built.window)).toEqual(new Set(['wood', 'brass', 'bulb']));
    // the scenery's layers stand far enough apart that the stage's contact shading (thickness 1.2 along the view) cannot join them
    const gaps = [SCENE.near - -0.17, SCENE.mid - SCENE.near, SCENE.far - SCENE.mid].map((d) => Math.abs(d) * Math.cos((33 * Math.PI) / 180));
    for (const g of gaps) expect(g).toBeGreaterThan(1.2);
  });

  it('is deterministic', () => {
    expect(hash(windowPiece({ seed: 4 }))).toBe(hash(windowPiece({ seed: 4 })));
    expect(hash(roomEnd({ side: 'left', seed: 2 }))).toBe(hash(roomEnd({ side: 'left', seed: 2 })));
  });
});

describe('catalogue', () => {
  it('registers the room pieces and builds every variant', () => {
    const all = [...benchCatalogue, ...roomCatalogue, ...windowCatalogue];
    for (const name of ['bench-frame', 'floor', 'room-left', 'room-right', 'window', 'back-wall']) expect(all.some((e) => e.name === name)).toBe(true);
    for (const e of [...roomCatalogue, ...windowCatalogue, ...benchCatalogue.filter((q) => q.name === 'bench-frame' || q.name === 'back-wall')]) {
      for (const v of Object.values(e.variants ?? { default: {} })) expect(e.build(v).triangles).toBeGreaterThan(0);
    }
  });
});
