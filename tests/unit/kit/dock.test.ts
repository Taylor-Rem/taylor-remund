import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { DOCK, DOOR_TRAVEL, LIP_Y, NAMED_POSES, catalogue, dock, doorNormal, fitRamp, poseDock, rampAt, rampGeom, rampRollers, slatMatrix, slats } from '../../../src/workshop/view/kit/pieces/dock/index.ts';
import { checkGeometry } from './helpers.ts';

const CAP = 7000; // ART-P2 § 4

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

describe('the dock', () => {
  const p = dock();

  it('stays inside its triangle cap, at three draw classes or so', () => {
    const b = K.budget(p, CAP);
    if (process.env['DOCK_TRIS']) console.warn(b.text, JSON.stringify(p.size));
    expect(p.triangles).toBeLessThanOrEqual(CAP);
    expect(p.triangles).toBe(K.countTriangles(p));
    expect(dock({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
    expect(b.meshes).toBeLessThanOrEqual(7);
  });

  it('builds deterministically, and another seed differs', () => {
    const a = dock({ seed: 3 }), b = dock({ seed: 3 }), c = dock({ seed: 4 });
    const arr = (q: Piece) => Array.from(q.root.children!.find((c) => c.name === 'bay')!.parts.find((x) => x.material === 'steel')!.geometry.getAttribute('position').array);
    expect(arr(a)).toEqual(arr(b));
    expect(arr(a)).not.toEqual(arr(c));
  });

  it('every part is a sound kit geometry', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('the doorway passes a robot 1.6 tall and 1.25 wide', () => {
    expect(DOCK.openH).toBeGreaterThanOrEqual(1.7);
    expect(DOCK.openW).toBeGreaterThanOrEqual(1.45);
    // the portal stays about 1.9 wide and 2.0 tall (its lamp and bell aside)
    expect(DOCK.openW + 2 * DOCK.jambW).toBeLessThanOrEqual(1.95);
    expect(DOCK.sillY + DOCK.openH + DOCK.housingH).toBeLessThanOrEqual(2.1);
  });

  it('has the moving nodes the view drives', () => {
    const n = nodes(p);
    for (const name of ['bay', 'bell', 'bell.clapper', 'flap', 'lamp', 'lamp.lit', 'lamp.unlit']) expect(n.get(name), name).toBeDefined();
    for (const s of slats()) expect(n.get(s.name), s.name).toBeDefined();
    const rollers = rampRollers(rampGeom());
    for (let i = 0; i < rollers.length; i++) expect(n.get(`ramp.roller${i}`)).toBeDefined();
    // the lit lamp starts hidden
    expect(new Vector3().setFromMatrixScale(n.get('lamp.lit')!.transform!).x).toBeLessThan(1e-3);
  });

  it('the ramp starts level at the belt height heading +X, and ends square into the door at the sill', () => {
    const g = rampGeom();
    const a = rampAt(g, 0), z = rampAt(g, g.length);
    expect(a.y).toBeCloseTo(DOCK.rampTopIn, 5);
    expect(a.hx).toBeCloseTo(1, 5);
    expect(z.y).toBeCloseTo(DOCK.sillY, 5);
    const [nx, , nz] = doorNormal();
    expect(z.hx).toBeCloseTo(-nx, 5);
    expect(z.hz).toBeCloseTo(-nz, 5);
    expect([z.x, z.z]).toEqual([expect.closeTo(g.end[0], 5), expect.closeTo(g.end[2], 5)]);
    // it starts where it was asked to (the blockout's belt end)
    expect(a.x).toBeCloseTo(DOCK.reach[0], 5);
    expect(a.z).toBeCloseTo(DOCK.reach[1], 5);
    // continuous: no jumps between samples
    let prev = rampAt(g, 0);
    for (let s = 0.02; s <= g.length; s += 0.02) {
      const q = rampAt(g, s);
      expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(0.021);
      prev = q;
    }
    expect(fitRamp([-1.5, 0.45]).approach).toBeLessThan(fitRamp().approach);
  });

  it('sockets: belt, in, threshold, door, vanish, return, bell, lamp', () => {
    const s = p.sockets!;
    for (const k of ['belt', 'in', 'ramp.mid', 'threshold', 'door', 'vanish', 'return', 'bell', 'lamp']) expect(s[k], k).toBeDefined();
    expect(pos(s['belt']!).x).toBeLessThan(pos(s['in']!).x);
    expect(pos(s['in']!).y).toBeCloseTo(DOCK.rampTopIn, 5);
    // vanish is inside the bay, behind the door: along -normal
    const [nx, , nz] = doorNormal();
    const v = pos(s['vanish']!);
    expect(v.x * nx + v.z * nz).toBeLessThan(-0.4);
  });

  it('the shutter: shut covers the opening, open hides every slat inside the housing', () => {
    const list = slats();
    expect(list[0]!.y0).toBeCloseTo(DOCK.sillY, 5);
    const top = list[list.length - 1]!;
    expect(top.y0 + top.h).toBeCloseTo(LIP_Y, 5);
    for (const s of list) {
      const shut = slatMatrix(s, 0);
      expect(new Vector3().setFromMatrixScale(shut).x).toBe(1);
      const open = slatMatrix(s, 1);
      expect(new Vector3().setFromMatrixScale(open).x).toBeLessThan(1e-3);
    }
    // half: the lower slats show, risen by half the travel
    const half = slatMatrix(list[0]!, 0.5);
    expect(pos(half).y).toBeCloseTo(DOOR_TRAVEL / 2, 5);
  });

  it('poses build, and change only node transforms', () => {
    for (const name of Object.keys(NAMED_POSES)) {
      const q = dock({ pose: name });
      expect(q.triangles).toBe(p.triangles);
    }
    const q = dock();
    poseDock(q.root, { bell: 20, flap: 30, lamp: 1, door: 1 }, rampRollers().length);
    const n = nodes(q);
    expect(new Vector3().setFromMatrixScale(n.get('lamp.lit')!.transform!).x).toBeCloseTo(1, 5);
    expect(new Vector3().setFromMatrixScale(n.get('lamp.unlit')!.transform!).x).toBeLessThan(1e-3);
  });

  it('is in the catalogue', () => {
    expect(catalogue.map((e) => e.name)).toContain('dock');
    expect(catalogue[0]!.build({ pose: 'open' }).triangles).toBe(p.triangles);
  });
});
