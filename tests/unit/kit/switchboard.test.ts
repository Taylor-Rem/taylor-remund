import { describe, expect, it } from 'vitest';
import { Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import type { Material, Mesh, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import {
  BOARD, catalogue, cordGeometry, cordPlug, JACKS, lensColour, NAMED_POSES, PLUG, POSE, poseSwitchboard, SEAT_Y, stool, switchboard, updateCord,
} from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';

const BUDGET = { switchboard: 14000, stool: 2500, plug: 1200 };

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

const pos = (m: Matrix4): Vector3 => new Vector3().setFromMatrixPosition(m);

function report(p: Piece): void {
  if (!process.env['SWITCHBOARD_TRIS']) return;
  console.log(K.budget(p).text, 'size', JSON.stringify(p.size));
}

describe('the switchboard', () => {
  const p = switchboard();
  report(p);

  it('builds deterministically, and another seed differs', () => {
    const a = switchboard({ seed: 3 }), b = switchboard({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    const x = a.root.parts[0]!.geometry.getAttribute('position').array, y = b.root.parts[0]!.geometry.getAttribute('position').array;
    expect(Array.from(x)).toEqual(Array.from(y));
    expect(Array.from(switchboard({ seed: 4 }).root.parts[1]!.geometry.getAttribute('position').array)).not.toEqual(Array.from(a.root.parts[1]!.geometry.getAttribute('position').array));
  });

  it('stays inside its triangle budget at both details', () => {
    expect(p.triangles).toBeLessThanOrEqual(BUDGET.switchboard);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(switchboard({ detail: 'low' }).triangles).toBeLessThan(p.triangles * 0.8);
  });

  it('has a lamp node and a drawer node per live jack, and its sockets', () => {
    const n = nodes(p);
    for (const j of JACKS) {
      expect(n.get(`lamp.${j}`)?.parts.some((q) => q.material === 'bulb'), `lamp.${j}`).toBe(true);
      expect(n.has(`drawer.${j}`), `drawer.${j}`).toBe(true);
      for (const s of [`jack.${j}`, `lamp.${j}`, `label.${j}`]) expect(p.sockets?.[s], s).toBeDefined();
    }
    for (const s of ['cord.root', 'stool']) expect(p.sockets?.[s], s).toBeDefined();
    // the bulb class is used for the two live lenses only
    let bulbs = 0;
    const walk = (nd: PieceNode): void => {
      for (const q of nd.parts) if (q.material === 'bulb') bulbs++;
      for (const c of nd.children ?? []) walk(c);
    };
    walk(p.root);
    expect(bulbs).toBe(2);
  });

  it('is about the size the brief asks for, standing on the bench', () => {
    const b = K.pieceBounds(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(b.min.y).toBeLessThan(0.01);
    expect(p.size.x).toBeGreaterThan(4.2);
    expect(p.size.x).toBeLessThan(4.8);
    expect(p.size.y).toBeGreaterThan(2.6);
    expect(p.size.y).toBeLessThan(3.2);
  });

  it('puts the jacks where a seated raccoon reaches them, above their tape, the cord root on the keyshelf', () => {
    for (const j of JACKS) {
      const jp = pos(p.sockets![`jack.${j}`]!), lp = pos(p.sockets![`label.${j}`]!);
      // Patch's reach paw comes up to about SEAT_Y + 0.41 (patch-toy rig); the jack's escutcheon spans ±0.175
      expect(Math.abs(jp.y - (SEAT_Y + 0.41))).toBeLessThan(0.12);
      expect(lp.y).toBeLessThan(jp.y - 0.25);
      expect(jp.z).toBeGreaterThan(0);
    }
    const r = pos(p.sockets!['cord.root']!);
    expect(r.y).toBeGreaterThan(BOARD.shelfY);
    expect(r.z).toBeGreaterThan(0.1);
    expect(r.z).toBeLessThan(BOARD.shelfZ);
  });

  it('builds with label refs as textured tape and cards', () => {
    const refs = {
      tape: { storefront: { key: 'tape-s', w: 2.52, h: 0.43 }, lamp: { key: 'tape-l', w: 1.2, h: 0.43 } },
      card: { storefront: { key: 'card-s', w: 0.24, h: 0.1 }, lamp: { key: 'card-l', w: 0.22, h: 0.1 } },
    };
    const q = switchboard({ labels: refs });
    const keys: string[] = [];
    const walk = (nd: PieceNode): void => {
      for (const x of nd.parts) if (x.texture) keys.push(x.texture);
      for (const c of nd.children ?? []) walk(c);
    };
    walk(q.root);
    expect(keys.sort()).toEqual(['card-l', 'card-s', 'tape-l', 'tape-s']);
  });

  it('poses: drawers slide out along +Z, lamps light, on a realized board and on a piece', () => {
    const o = K.realize(switchboard(), stub);
    const d = o.getObjectByName('drawer.storefront')!;
    const before = d.getWorldPosition(new Vector3());
    poseSwitchboard(o, { drawers: { storefront: 1 }, lamps: { lamp: 1 } });
    o.updateMatrixWorld(true);
    const after = d.getWorldPosition(new Vector3());
    expect(after.z - before.z).toBeCloseTo(POSE.drawerTravel, 5);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-6);
    const lens = o.getObjectByName('lamp.lamp')!.children.find((c) => (c as Mesh).isMesh) as Mesh;
    expect(lens.geometry.getAttribute('color').getX(0)).toBeCloseTo(lensColour(1)[0], 5);
    poseSwitchboard(o, { drawers: { storefront: 0 } });
    o.updateMatrixWorld(true);
    expect(d.getWorldPosition(new Vector3()).distanceTo(before)).toBeLessThan(1e-6);
    for (const name of Object.keys(NAMED_POSES)) expect(() => switchboard({ pose: name })).not.toThrow();
  });

  it('every catalogue entry builds', () => {
    expect(catalogue.map((e) => e.name).sort()).toEqual(['cord-plug', 'stool', 'switchboard']);
    for (const e of catalogue) expect(e.build({}).triangles).toBeGreaterThan(0);
  });

  it('its live jacks are the simulation\'s two jacks', () => {
    expect(vignette.cord?.jacks.map((j) => j.id).sort()).toEqual(JACKS.map((j) => `jack-${j}`).sort());
  });
});

describe('the stool', () => {
  const s = stool();
  report(s);
  it('stays inside its budget and stands on the bench with its seat at SEAT_Y', () => {
    expect(s.triangles).toBeLessThanOrEqual(BUDGET.stool);
    const b = K.pieceBounds(s);
    expect(b.min.y).toBeGreaterThan(-0.005);
    expect(b.max.y).toBeGreaterThan(SEAT_Y - 0.02);
    expect(b.max.y).toBeLessThan(SEAT_Y + 0.03);
    expect(pos(s.sockets!['seat']!).y).toBeCloseTo(SEAT_Y, 5);
  });
});

describe('the plug and the cord', () => {
  const pl = cordPlug();
  report(pl);
  it('stays inside its budget; seats at its origin, tip down -Z, cord leaving along +Z', () => {
    expect(pl.triangles).toBeLessThanOrEqual(BUDGET.plug);
    const b = K.pieceBounds(pl);
    expect(b.min.z).toBeCloseTo(-PLUG.insert, 2);
    expect(b.max.z).toBeCloseTo(PLUG.cordAt, 2);
    expect(pos(pl.sockets!['cord']!).z).toBeCloseTo(PLUG.cordAt, 5);
    const dir = new Vector3(0, 0, 1).transformDirection(pl.sockets!['cord']!);
    expect(dir.z).toBeCloseTo(1, 5);
  });

  it('cord geometry has a fixed topology and moves in place', () => {
    const pts = Array.from({ length: 24 }, (_, i) => new Vector3(i * 0.1, 0.5 - Math.sin(i / 7) * 0.3, 0));
    const g = cordGeometry(pts);
    const n = g.getAttribute('position').count;
    const posArr = g.getAttribute('position').array;
    const moved = pts.map((q) => q.clone().add(new Vector3(0, 0, 1)));
    updateCord(g, moved);
    expect(g.getAttribute('position').count).toBe(n);
    expect(g.getAttribute('position').array).toBe(posArr);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.z).toBeGreaterThan(1 - PLUG.cordR - 1e-4);
    // every attribute the materials expect
    for (const a of ['position', 'normal', 'color', 'surf', 'lpos']) expect(g.getAttribute(a), a).toBeDefined();
    // outward winding: the first triangle's face normal points away from the cord's axis
    const ia = g.index!.array, P = g.getAttribute('position');
    const v = (k: number) => new Vector3().fromBufferAttribute(P, ia[k]!);
    const fn = v(1).sub(v(0)).cross(v(2).sub(v(0)));
    const out = v(0).sub(moved[0]!);
    expect(fn.dot(out)).toBeGreaterThan(0);
    expect(() => updateCord(g, pts.slice(1))).toThrow();
  });

  it('is cheap enough to rebuild every frame (24 points under 2,000 triangles)', () => {
    const g = cordGeometry(Array.from({ length: 24 }, (_, i) => [i * 0.1, 0.2, 0] as const));
    expect(K.triangleCount(g)).toBeLessThan(2000);
  });
});

describe('Patch on the stool, at the board', () => {
  it("Patch's reach paw comes up to the live jacks' height from the seat socket", async () => {
    const { patchToy, posePatch, SIT_YAW } = await import('../../../src/workshop/view/kit/pieces/patch-toy/index.ts');
    const s = stool();
    const o: Object3D = K.realize(patchToy({}), stub);
    o.position.copy(pos(s.sockets!['seat']!));
    o.rotation.y = (SIT_YAW * Math.PI) / 180;
    posePatch(o, { arms: 'reach' });
    o.updateMatrixWorld(true);
    const paw = o.getObjectByName('pawL')!.getWorldPosition(new Vector3());
    expect(Math.abs(paw.y - BOARD.jackY)).toBeLessThan(0.1);
  });
});
