import { describe, expect, it } from 'vitest';
import { Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import type { Material, Mesh, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { linear, paints } from '../../../src/workshop/view/palette.ts';
import { catalogue, nozzleTip, platen, posePlaten, setPaint, tapeFace, PLATEN, NAMED_POSES, PLATE_TEXT, PLATE_CAP, HIDDEN } from '../../../src/workshop/view/kit/pieces/platen/index.ts';
import { ROBOT_H, ROBOT_W } from '../../../src/workshop/view/kit/pieces/platen/load.ts';
import { checkGeometry } from './helpers.ts';

const CAP = 6000; // ART-P2 § 4

const stub: Materials = {
  of: (): Material => new MeshBasicMaterial(),
  textured: (): Material => new MeshBasicMaterial(),
  update() {},
  dispose() {},
};

function nodes(p: Piece): Map<string, PieceNode> {
  const out = new Map<string, PieceNode>();
  const walk = (n: PieceNode): void => {
    out.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

/** World matrix of a node in a Piece's tree (as posed). */
function worldOf(p: Piece, name: string): Matrix4 | undefined {
  let found: Matrix4 | undefined;
  const walk = (n: PieceNode, parent: Matrix4): void => {
    const w = parent.clone().multiply(n.transform ?? new Matrix4());
    if (n.name === name) found = w;
    for (const c of n.children ?? []) walk(c, w);
  };
  walk(p.root, new Matrix4());
  return found;
}

const pos = (m: Matrix4): Vector3 => new Vector3().setFromMatrixPosition(m);

describe('the platen', () => {
  const p = platen();

  it('builds deterministically, and a seed changes it', () => {
    const a = platen({ seed: 3 }), b = platen({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    const x = a.root.parts[0]!.geometry.getAttribute('position').array, y = b.root.parts[0]!.geometry.getAttribute('position').array;
    expect(Array.from(x)).toEqual(Array.from(y));
    expect(Array.from(platen({ seed: 4 }).root.parts[0]!.geometry.getAttribute('position').array)).not.toEqual(Array.from(x));
  });

  it.runIf(process.env['PLATEN_TRIS'])('reports triangles by source line (PLATEN_TRIS=1, for the diet)', () => {
    const NB = K.NodeBuilder.prototype as unknown as { add: (...p: K.PartsLike[]) => unknown; small: (...p: unknown[]) => unknown };
    const add = NB.add, small = NB.small;
    const byLine = new Map<string, number>();
    const tally = (p: K.PartsLike[]): void => {
      const line = /platen\/index\.ts:(\d+)/.exec(new Error().stack ?? '')?.[1] ?? '?';
      for (const q of K.flat(p)) byLine.set(line, (byLine.get(line) ?? 0) + K.triangleCount(q.geometry));
    };
    NB.add = function (this: unknown, ...p: K.PartsLike[]) { tally(p); return add.apply(this, p); };
    NB.small = function (this: unknown, ...p: unknown[]) { tally(p.map((q) => (typeof q === 'function' ? (q as () => K.PartsLike)() : q)) as K.PartsLike[]); return small.apply(this, p); };
    try {
      platen();
    } finally {
      NB.add = add;
      NB.small = small;
    }
    process.stderr.write([...byLine].sort((a, b) => b[1] - a[1]).map(([l, t]) => `L${l} ${t}`).join('  ') + '\n');
  });

  it('stays inside its triangle cap', () => {
    if (process.env['PLATEN_TRIS']) console.log(K.budget(p, CAP).text, '\nlow', platen({ detail: 'low' }).triangles, 'size', JSON.stringify(p.size));
    expect(p.triangles).toBeLessThanOrEqual(CAP);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(platen({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
  });

  it('has every geometry well formed', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('has the named nodes the brief asks for, and its lamp', () => {
    const n = nodes(p);
    for (const name of ['tray', 'arm', 'nozzle', 'tapehead', 'gauge.needle', 'nozzle.paint', 'sight.paint', 'tapehead.tape', 'handwheel', 'lamp.lit', 'lamp.unlit']) expect(n.has(name), name).toBe(true);
    for (const name of ['idle', 'over', 'dipping', 'pressing']) expect(NAMED_POSES[name], name).toBeDefined();
  });

  it('rests on the bench, about the size the plan gives it', () => {
    const bb = K.pieceBounds(p);
    expect(bb.min.y).toBeGreaterThan(-2e-3);
    expect(bb.min.y).toBeLessThan(0.01);
    expect(bb.max.x - bb.min.x).toBeLessThan(3.6);
    expect(bb.max.y).toBeLessThan(3.1);
  });

  it('exposes its sockets', () => {
    for (const s of ['seat', 'nozzle.tip', 'tapehead.face', 'jack', 'conduit', 'lamp', 'plate']) expect(p.sockets?.[s], s).toBeDefined();
    const seat = pos(p.sockets!['seat']!);
    expect(seat.x).toBeCloseTo(PLATEN.tray.x, 5);
    expect(seat.y).toBeCloseTo(PLATEN.deckY + PLATEN.tray.seatY, 5);
  });

  it('puts the nozzle over the tray when swung, and parks it off the tray', () => {
    const over = pos(nozzleTip({ swing: 1 }));
    expect(Math.hypot(over.x - PLATEN.tray.x, over.z - PLATEN.tray.z)).toBeLessThan(1e-6);
    const idle = pos(nozzleTip({}));
    expect(Math.hypot(idle.x - PLATEN.tray.x, idle.z - PLATEN.tray.z)).toBeGreaterThan(PLATEN.tray.dishR);
    // the computed tip agrees with the posed node tree
    for (const name of ['idle', 'over', 'dipping']) {
      const q = platen({ pose: name });
      const tip = pos(worldOf(q, 'nozzle.paint')!);
      const want = pos(nozzleTip(NAMED_POSES[name]!));
      expect(tip.distanceTo(want), name).toBeLessThan(1e-5);
    }
  });

  it('clears a 1.6 robot when it swings, and dips to reach it and an L crate', () => {
    const seatY = PLATEN.deckY + PLATEN.tray.seatY;
    // swinging (dip 0) the tip passes over a robot 1.6 tall standing on the seat
    for (let s = 0; s <= 1; s += 0.1) expect(pos(nozzleTip({ swing: s })).y - (seatY + ROBOT_H)).toBeGreaterThan(0.1);
    // fully dipped, the tip comes down to an L crate's lid; a little dip brings it to the robot's head
    const dipped = pos(nozzleTip({ swing: 1, dip: 1 }));
    expect(dipped.y - (seatY + 0.8)).toBeGreaterThan(0.1);
    expect(dipped.y - (seatY + 0.8)).toBeLessThan(0.35);
    expect(pos(nozzleTip({ swing: 1, dip: 0.1 })).y - (seatY + ROBOT_H)).toBeLessThan(0.12);
    // parked, the column and the arm stand clear of a robot 1.25 wide turning on the tray
    expect(Math.hypot(PLATEN.pillar.x - PLATEN.tray.x, PLATEN.pillar.z - PLATEN.tray.z) - 0.1).toBeGreaterThan(ROBOT_W / 2);
    expect(Math.hypot(PLATEN.tank.x - PLATEN.tray.x, PLATEN.tank.z - PLATEN.tray.z) - PLATEN.tank.r).toBeGreaterThan(ROBOT_W / 2);
    expect(PLATEN.tray.x - pos(tapeFace({})).x).toBeGreaterThan(ROBOT_W / 2 + 0.1);
    // the tape head pressed reaches an L crate's face but stops before the middle of the tray
    const face = pos(tapeFace({ press: 1 }));
    expect(PLATEN.tray.x - face.x).toBeLessThan(0.42);
    expect(PLATEN.tray.x - face.x).toBeGreaterThan(0.3);
  });

  it('builds with a crate or a robot on the tray', () => {
    for (const load of ['crate', 'robot'] as const) {
      const q = platen({ load });
      expect(nodes(q).has('load')).toBe(true);
      expect(q.triangles).toBeGreaterThan(p.triangles);
    }
  });

  it('poses by node transforms only, and the lamp swaps', () => {
    const o = K.realize(platen(), stub);
    const snap = (x: Object3D): number[] => [...x.position.toArray(), ...x.quaternion.toArray(), ...x.scale.toArray()];
    const before = new Map<string, number[]>();
    o.traverse((x) => before.set(x.uuid, snap(x)));
    posePlaten(o, NAMED_POSES['pressing']!);
    const lit = o.getObjectByName('lamp.lit')!, unlit = o.getObjectByName('lamp.unlit')!;
    expect(lit.scale.x).toBeCloseTo(1, 6);
    expect(unlit.scale.x).toBeCloseTo(HIDDEN, 6);
    const head = o.getObjectByName('tapehead')!;
    expect(head.position.x).toBeGreaterThan(before.get(head.uuid)![0]!);
    // back to idle restores every node exactly
    posePlaten(o, {});
    let moved = 0;
    o.traverse((x) => {
      const a = before.get(x.uuid)!, b = snap(x);
      if (a.some((v, i) => Math.abs(v - b[i]!) > 1e-6)) moved++;
    });
    expect(moved).toBe(0);
  });

  it('shows any of the eight paints in the sight tube without a rebuild, twins untouched', () => {
    const piece = platen();
    const a = K.realize(piece, stub), b = K.realize(piece, stub);
    for (const paint of paints) {
      expect(setPaint(a, paint)).toBeGreaterThan(0);
      const want = linear(paint);
      let checked = 0;
      a.traverse((x) => {
        const m = x as Mesh;
        if (!m.isMesh) return;
        for (const s of K.sourcesOf(m)) {
          if (s.node !== 'sight.paint') continue;
          const c = m.geometry.getAttribute('color');
          const i = s.start;
          const ratio = [c.getX(i) / want[0], c.getY(i) / want[1], c.getZ(i) / want[2]];
          expect(Math.abs(ratio[0]! - ratio[1]!)).toBeLessThan(1e-3);
          expect(Math.abs(ratio[1]! - ratio[2]!)).toBeLessThan(1e-3);
          checked++;
        }
      });
      expect(checked).toBeGreaterThan(0);
    }
    // the other realization still shows the paint it was built with
    const blue = linear('paint-blue');
    b.traverse((x) => {
      const m = x as Mesh;
      if (!m.isMesh) return;
      for (const s of K.sourcesOf(m)) if (s.node === 'sight.paint') expect(m.geometry.getAttribute('color').getZ(s.start) / blue[2]).toBeCloseTo(m.geometry.getAttribute('color').getX(s.start) / blue[0], 3);
    });
  });

  it('reads its word from content, big enough for the 12 px rule', () => {
    expect(PLATE_TEXT).toBe('PLATEN');
    expect(PLATE_CAP).toBeGreaterThan(0.19);
    const e = catalogue[0]!;
    expect(e.name).toBe('platen');
    expect(e.poses).toEqual(expect.arrayContaining(['idle', 'over', 'dipping', 'pressing']));
    for (const paint of paints) expect(e.variants?.[paint]).toBeDefined();
  });
});
