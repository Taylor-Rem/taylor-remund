import { describe, expect, it } from 'vitest';
import { Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import {
  BOARD, BOARD_WHOLE, catalogue, COLLAR_LIFT, cordGeometry, cordPlug, estimateLabels, JACKS, NAMED_POSES, OPERATOR, OPERATOR_POSES, PLUG, POSE, poseSwitchboard,
  SEAT_Y, SLICE_JACKS, stool, STOOL_SEAT, switchboard, TAPE_CAP_WHOLE, updateCord,
} from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import type { JackName } from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import { poseMatrices } from '../../../src/workshop/view/kit/pieces/patch-felt/rig.ts';
import { vignette } from '../../../src/workshop/sim/scenes/vignette.ts';

/** The brief's caps (V-switchboard-r): 8,000 triangles and 5 meshes (blank: label textures add one each). */
const BUDGET = { switchboard: 8000, meshes: 5, stool: 2500, plug: 1200 };

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

function textures(p: Piece): string[] {
  const keys: string[] = [];
  const walk = (nd: PieceNode): void => {
    for (const x of nd.parts) if (x.texture) keys.push(x.texture);
    for (const c of nd.children ?? []) walk(c);
  };
  walk(p.root);
  return keys.sort();
}

function report(p: Piece): void {
  if (!process.env['SWITCHBOARD_TRIS']) return;
  console.log(K.budget(p).text, 'size', JSON.stringify(p.size));
}

describe('the switchboard, both builds', () => {
  const builds: Array<[string, Piece, readonly JackName[]]> = [
    ['slice', switchboard(), SLICE_JACKS],
    ['whole', switchboard({ jacks: JACKS }), JACKS],
  ];
  for (const [name, p, live] of builds) {
    report(p);
    it(`${name}: inside 8,000 triangles and 5 meshes at both details`, () => {
      const bud = K.budget(p);
      expect(p.triangles).toBeLessThanOrEqual(BUDGET.switchboard);
      expect(p.triangles).toBe(K.countTriangles(p));
      expect(bud.meshes).toBeLessThanOrEqual(BUDGET.meshes);
      expect(switchboard({ jacks: live, detail: 'low' }).triangles).toBeLessThan(p.triangles);
    });

    it(`${name}: a lamp, a collar, a drawer and the sockets per live jack`, () => {
      const n = nodes(p);
      for (const j of live) {
        expect(n.get(`lamp.${j}.lit`)?.parts.some((q) => q.material === 'bulb'), `lamp.${j}.lit`).toBe(true);
        expect(n.has(`lamp.${j}.unlit`), `lamp.${j}.unlit`).toBe(true);
        expect(n.has(`collar.${j}`), `collar.${j}`).toBe(true);
        expect(n.has(`drawer.${j}`), `drawer.${j}`).toBe(true);
        for (const s of [`jack.${j}`, `lamp.${j}`, `label.${j}`, `drawer.${j}`]) expect(p.sockets?.[s], s).toBeDefined();
      }
      for (const j of JACKS.filter((x) => !live.includes(x))) expect(n.has(`drawer.${j}`)).toBe(false);
      for (const s of ['cord.root', 'stool']) expect(p.sockets?.[s], s).toBeDefined();
      // only the lit lenses glow at rest: they are built collapsed (one per live jack, and T1's cord lamp in the keyshelf)
      expect([...n.keys()].filter((k) => k.endsWith('.lit')).length).toBe(live.length + 1);
      expect(n.get('lamp.cord.lit')?.parts.some((q) => q.material === 'bulb')).toBe(true);
    });

    it(`${name}: poses on the default (skinned) backend: drawers out along +Z, collars lift, lamps swap`, () => {
      const o = K.realize(p, stub);
      const j = live[0]!;
      const d = o.getObjectByName(`drawer.${j}`)!, c = o.getObjectByName(`collar.${j}`)!;
      o.updateMatrixWorld(true);
      const d0 = d.getWorldPosition(new Vector3()), c0 = c.getWorldPosition(new Vector3());
      const scaleOf = (nm: string): number => {
        o.updateMatrixWorld(true);
        return new Vector3().setFromMatrixScale(o.getObjectByName(nm)!.matrixWorld).x;
      };
      expect(scaleOf(`lamp.${j}.lit`)).toBeLessThan(0.01);
      poseSwitchboard(o, { drawers: { [j]: 1 }, lamps: { [j]: 1 }, collars: { [j]: 1 } });
      o.updateMatrixWorld(true);
      expect(d.getWorldPosition(new Vector3()).z - d0.z).toBeCloseTo(POSE.drawerTravel, 5);
      expect(c.getWorldPosition(new Vector3()).z - c0.z).toBeCloseTo(COLLAR_LIFT, 5);
      expect(scaleOf(`collar.${j}`)).toBeCloseTo(1 + POSE.collarSwell, 5);
      expect(scaleOf(`lamp.${j}.lit`)).toBeCloseTo(1, 5);
      expect(scaleOf(`lamp.${j}.unlit`)).toBeLessThan(0.01);
      poseSwitchboard(o, NAMED_POSES['rest']!);
      o.updateMatrixWorld(true);
      expect(d.getWorldPosition(new Vector3()).distanceTo(d0)).toBeLessThan(1e-6);
      expect(c.getWorldPosition(new Vector3()).distanceTo(c0)).toBeLessThan(1e-6);
      expect(scaleOf(`collar.${j}`)).toBeCloseTo(1, 5);
    });

    it(`${name}: the 'nodes' and 'skinned' backends agree for every named pose, and a build-time pose matches`, () => {
      const names = live.flatMap((j) => [`drawer.${j}`, `collar.${j}`, `lamp.${j}.lit`, `lamp.${j}.unlit`]);
      for (const pose of Object.keys(NAMED_POSES)) {
        const n = K.realize(p, stub, { backend: 'nodes' }), s = K.realize(p, stub, { backend: 'skinned' });
        const built = K.realize(switchboard({ jacks: live, pose }), stub, { backend: 'nodes' });
        poseSwitchboard(n, NAMED_POSES[pose]!);
        poseSwitchboard(s, NAMED_POSES[pose]!);
        for (const o of [n, s, built]) o.updateMatrixWorld(true);
        for (const nm of names) {
          const mn = n.getObjectByName(nm)!.matrixWorld.elements, ms = s.getObjectByName(nm)!.matrixWorld.elements, mb = built.getObjectByName(nm)!.matrixWorld.elements;
          mn.forEach((v, k) => {
            expect(ms[k]!, `${pose} ${nm}`).toBeCloseTo(v, 5);
            expect(mb[k]!, `${pose} ${nm} (built)`).toBeCloseTo(v, 5);
          });
        }
      }
    });
  }

  it('builds deterministically, and another seed differs', () => {
    for (const jacks of [SLICE_JACKS, JACKS]) {
      const a = switchboard({ seed: 3, jacks }), b = switchboard({ seed: 3, jacks });
      expect(a.triangles).toBe(b.triangles);
      expect(Array.from(a.root.parts[0]!.geometry.getAttribute('position').array)).toEqual(Array.from(b.root.parts[0]!.geometry.getAttribute('position').array));
      expect(Array.from(switchboard({ seed: 4, jacks }).root.parts[1]!.geometry.getAttribute('position').array)).not.toEqual(Array.from(a.root.parts[1]!.geometry.getAttribute('position').array));
    }
  });

  it('builds with label refs as textured tape and cards (and RESERVED on the whole board)', () => {
    const ref = (key: string) => ({ key, w: 1, h: 0.4 });
    const slice = switchboard({ labels: { tape: { storefront: ref('t-s'), lamp: ref('t-l') }, card: { storefront: ref('c-s'), lamp: ref('c-l') } } });
    expect(textures(slice)).toEqual(['c-l', 'c-s', 't-l', 't-s']);
    const tape = Object.fromEntries(JACKS.map((j) => [j, ref(`t-${j}`)]));
    const card = Object.fromEntries(JACKS.map((j) => [j, ref(`c-${j}`)]));
    const whole = switchboard({ jacks: JACKS, labels: { tape, card, reserved: ref('r') } });
    expect(textures(whole)).toEqual([...JACKS.map((j) => `c-${j}`), 'r', ...JACKS.map((j) => `t-${j}`)].sort());
  });

  it('every catalogue entry builds', () => {
    expect(catalogue.map((e) => e.name).sort()).toEqual(['cord-plug', 'stool', 'switchboard', 'switchboard-operator']);
    for (const e of catalogue) expect(e.build({}).triangles).toBeGreaterThan(0);
    const whole = catalogue.find((e) => e.name === 'switchboard')!;
    expect(K.budget(whole.build(whole.variants!['whole'])).total).toBe(switchboard({ jacks: JACKS }).triangles);
  });

  it("the slice's live jacks are the vignette simulation's two jacks", () => {
    expect(vignette.cord?.jacks.map((j) => j.id).sort()).toEqual(SLICE_JACKS.map((j) => `jack-${j}`).sort());
  });
});

describe('the G1 slice', () => {
  const p = switchboard();
  it('is the size it was, standing on the bench', () => {
    const b = K.pieceBounds(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(b.min.y).toBeLessThan(0.01);
    expect(p.size.x).toBeCloseTo(4.6, 2);
    expect(p.size.y).toBeGreaterThan(3.0);
    expect(p.size.y).toBeLessThan(3.2);
  });

  it('puts the jacks low, just above the keyshelf, each under its own tape with a clear margin', () => {
    const est = estimateLabels();
    for (const j of SLICE_JACKS) {
      const jp = pos(p.sockets![`jack.${j}`]!), lp = pos(p.sockets![`label.${j}`]!);
      expect(jp.y - 0.175).toBeGreaterThan(BOARD.shelfY + 0.08);
      expect(jp.y).toBeLessThan(BOARD.tapeY);
      expect(lp.y - est.tape[j].h / 2 - (jp.y + 0.175)).toBeGreaterThan(0.05);
      expect(Math.abs(lp.x - (BOARD.jackX[j]! + BOARD.lampDX / 2))).toBeLessThan(0.1);
      expect(jp.z).toBeGreaterThan(0);
    }
    const r = pos(p.sockets!['cord.root']!);
    expect(r.y).toBeGreaterThan(BOARD.shelfY);
    expect(r.z).toBeGreaterThan(0.1);
    expect(r.z).toBeLessThan(BOARD.shelfZ);
  });
});

describe('the whole board', () => {
  const p = switchboard({ jacks: JACKS });
  const L = BOARD_WHOLE;
  const est = estimateLabels(TAPE_CAP_WHOLE);

  it('is about 5.2 wide, under the sign, with its runner in front', () => {
    const b = K.pieceBounds(p);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
    expect(b.max.x - b.min.x).toBeLessThan(6.3);
    expect(b.max.y).toBeLessThan(3.25);
    // the cabinet itself (without the runner) is the brief's 5.2
    expect(L.w).toBeLessThanOrEqual(5.25);
  });

  it('has its four live jacks in one row, left to right STOREFRONT, PLATEN, BELT, LAMP', () => {
    const xs = JACKS.map((j) => pos(p.sockets![`jack.${j}`]!));
    for (let i = 1; i < xs.length; i++) expect(xs[i]!.x).toBeGreaterThan(xs[i - 1]!.x + 0.6);
    for (const v of xs) expect(v.y).toBeCloseTo(L.jackY, 6);
  });

  it('puts each tape over its own jack, and leaves the high tapes a window of plate down to their jacks', () => {
    for (const j of JACKS) {
      const jp = pos(p.sockets![`jack.${j}`]!), lp = pos(p.sockets![`label.${j}`]!);
      expect(lp.y).toBeGreaterThan(jp.y + 0.3);
      expect(Math.abs(lp.x - jp.x), j).toBeLessThan(0.12);
    }
    // no low-row tape crosses the column of a high-row tape's jack
    for (const hi of JACKS.filter((j) => L.tapeRow[j] === 'high')) {
      const x = L.jackX[hi];
      for (const lo of JACKS.filter((j) => L.tapeRow[j] === 'low')) {
        const c = pos(p.sockets![`label.${lo}`]!).x, w = est.tape[lo].w / 2 + 0.05;
        expect(Math.abs(x - c) > w + 0.15, `${lo} over ${hi}'s jack`).toBe(true);
      }
    }
  });

  it('is planned for a seated 1.5x Patch: drawer pulls above the seat, the stool runs along the board', () => {
    const seat = L.runner.top + STOOL_SEAT;
    for (const j of JACKS) {
      expect(pos(p.sockets![`drawer.${j}`]!).y, j).toBeGreaterThan(seat);
      const s = pos(p.sockets![`stool.${j}`]!);
      expect(s.y).toBeCloseTo(L.runner.top, 6);
      expect(s.x).toBeGreaterThan(L.runner.x0 + 0.3);
      expect(s.x).toBeLessThan(L.runner.x1 - 0.3);
    }
    expect(pos(p.sockets!['stool']!).x).toBeGreaterThan(L.w / 2 + 0.3);
  });

  it("Patch's paw (1.5x, on the lowered stool at each jack) reaches the seated plug and the drawer pull", () => {
    const seat = L.runner.top + STOOL_SEAT;
    const tip = (rootAt: Vector3, pose: (typeof OPERATOR_POSES)[string]): { tip: Vector3; top: number } => {
      const m = poseMatrices(pose);
      const root = new Matrix4().makeTranslation(rootAt.x, rootAt.y, rootAt.z).multiply(new Matrix4().makeRotationY(OPERATOR.yaw)).multiply(new Matrix4().makeScale(OPERATOR.scale, OPERATOR.scale, OPERATOR.scale));
      const spine = root.clone().multiply(m['spine']!);
      const paw = spine.clone().multiply(m['armR']!).multiply(m['forearmR']!).multiply(m['pawR']!);
      return { tip: new Vector3(0, -0.07, 0).applyMatrix4(paw), top: new Vector3(0, 0.45, 0).applyMatrix4(spine.clone().multiply(m['head']!)).y };
    };
    for (const j of JACKS) {
      const at = pos(p.sockets![`stool.${j}`]!).setY(seat);
      const grip = pos(p.sockets![`jack.${j}`]!).add(new Vector3(0, 0, 0.3));
      const g = tip(at, OPERATOR_POSES['grip']!);
      expect(g.tip.distanceTo(grip), `${j} plug`).toBeLessThan(0.06);
      expect(g.top).toBeLessThan(L.top);
      const d = tip(at, OPERATOR_POSES['drawer']!);
      expect(d.tip.distanceTo(pos(p.sockets![`drawer.${j}`]!)), `${j} drawer`).toBeLessThan(0.06);
      expect(d.tip.y).toBeGreaterThan(seat);
    }
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
  it('lowers to the operator height', () => {
    const lo = stool({ seatY: STOOL_SEAT });
    expect(pos(lo.sockets!['seat']!).y).toBeCloseTo(STOOL_SEAT, 5);
    expect(K.pieceBounds(lo).max.y).toBeLessThan(STOOL_SEAT + 0.03);
    expect(lo.triangles).toBeLessThanOrEqual(BUDGET.stool);
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
    for (const a of ['position', 'normal', 'color', 'surf', 'lpos']) expect(g.getAttribute(a), a).toBeDefined();
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

describe('Patch on the P1 stool, at the slice', () => {
  it("Patch's reach paw from the seat socket gets at least as high as the live jacks", async () => {
    const { patchFelt, posePatch, SIDE_ON } = await import('../../../src/workshop/view/kit/pieces/patch-felt/index.ts');
    const s = stool();
    const o: Object3D = K.realize(patchFelt({}), stub);
    o.position.copy(pos(s.sockets!['seat']!));
    o.rotation.y = SIDE_ON;
    posePatch(o, { arms: 'reach' });
    o.updateMatrixWorld(true);
    const paw = o.getObjectByName('pawL')!.getWorldPosition(new Vector3());
    expect(paw.y).toBeGreaterThan(BOARD.jackY);
  });
});
