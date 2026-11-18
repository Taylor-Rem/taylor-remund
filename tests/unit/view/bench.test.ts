/**
 * The whole bench's layout (brief L1; REWRITE.md § C, § B3, § B6; ART-P2
 * § 2-3), checked as geometry: the view's LAYOUT against the simulation's
 * bodies, the footprints against each other, Fetch's lane, the camera's
 * homes through the real camera rig at the review sizes, and that nothing
 * usable hides behind anything from the fixed camera.
 */
import { Box3, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../../src/workshop/view/stage/camera.ts';
import { benchStations, ORDER, BOUNDS, CREW_SCALE, DOCK_REACH, FRAMING, FRAME_PX, LANE_TAPE, LAYOUT, MAILBOX, MUST_SEE, REVERT_SCALE, SIGN_WORDS, homeBox, homeEdge, mailboxBox, shippedBoxes, shippedCrateFronts, SHIPPED, spotBox, type Spot, type StationKey } from '../../../src/workshop/view/bench.ts';
import { Quaternion, type Matrix4 } from 'three';
import { storefront } from '../../../src/workshop/view/kit/pieces/storefront/index.ts';
import { platen } from '../../../src/workshop/view/kit/pieces/platen/index.ts';
import { dock } from '../../../src/workshop/view/kit/pieces/dock/index.ts';
import { revert } from '../../../src/workshop/view/kit/pieces/revert/index.ts';
import { revertHatch } from '../../../src/workshop/view/kit/pieces/revert-hatch/index.ts';
import { MeshBasicMaterial, type Material, type Object3D } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import { patchFelt, posePatch, SIDE_ON } from '../../../src/workshop/view/kit/pieces/patch-felt/index.ts';
import { fitPieces, staticBox } from '../../../src/workshop/view/vignette.ts';
import { bench as scene, AT } from '../../../src/workshop/sim/scenes/bench.ts';
import { defaultHalfExtents } from '../../../src/workshop/sim/parts.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import { pieceFolders } from '../../../src/workshop/view/kit/pieces/registry.ts';
import { switchboard, stool } from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import { belt } from '../../../src/workshop/view/kit/pieces/belt/index.ts';
import { pieceBounds } from '../../../src/workshop/view/kit/compose.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

const S = LAYOUT.stations as Record<StationKey, Spot>;
const body = (id: string): Box3 => {
  const b = staticBox(scene, id);
  if (!b) throw new Error(`no static ${id}`);
  return b;
};
const fit = fitPieces(scene, { board: switchboard({ detail: 'low' }), stool: stool({ detail: 'low' }), belt: belt({ length: LAYOUT.beltLength, detail: 'low' }) }, { stool: { x: S.stool.x, z: S.stool.z }, phoneYaw: S.phone.yaw });

/** Where the fumbled crate comes to rest: about 0.5 left of the fumble, in front of the lane (the vignette's toss, unchanged). */
const REST: Vec3 = [AT.fumbleX - 0.55, 0.225, AT.lane.a[1] + 0.1];
/** Patch, drawn at the crew's scale on its seat: its seated box. */
const patchBox = (): Box3 => {
  const s = fit.stool.seat;
  return new Box3(new Vector3(s[0] - 0.35 * CREW_SCALE, s[1], s[2] - 0.3 * CREW_SCALE), new Vector3(s[0] + 0.35 * CREW_SCALE, s[1] + 1.1 * CREW_SCALE, s[2] + 0.3 * CREW_SCALE));
};
function cluster(): Record<string, Box3> {
  return {
    button: body('console').expandByVector(new Vector3(0, 0.45, 0)),
    crate: new Box3(new Vector3(REST[0] - 0.25, 0, REST[2] - 0.25), new Vector3(REST[0] + 0.25, 0.45, REST[2] + 0.25)),
    phone: body('phone'),
    patch: patchBox(),
  };
}

function rigAt(w: number, h: number): CameraRig {
  const aspect = w < h ? 0.5 : w / h;
  const rig = new CameraRig({ ...FRAMING.lens });
  rig.setAspect(w / h);
  rig.setSubject(homeBox(aspect), { edge: homeEdge(aspect, scene.bench), bounds: new Box3(new Vector3(...FRAMING.bounds.min), new Vector3(...FRAMING.bounds.max)) });
  rig.cutTo(rig.home());
  return rig;
}
const corners = (b: Box3): Vector3[] => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
const inFrame = (rig: CameraRig, pts: Vector3[]): boolean =>
  pts.every((p) => {
    const s = rig.worldToScreen(p);
    return Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1;
  });

describe('the layout table and the simulation agree', () => {
  /** Stations with a body: the spot's origin is the body's centre, its footprint and height the body's. */
  const bodies: Array<[StationKey, string]> = [
    ['board', 'board'], ['stool', 'stool'], ['phone', 'phone'], ['button', 'console'],
    ['undo', 'undo'], ['striker', 'striker'],
  ];
  it.each(bodies)('%s stands where its body is', (key, id) => {
    const s = S[key];
    const st = scene.statics.find((q) => q.id === id)!;
    expect(st, id).toBeTruthy();
    expect(st.pose.p[0]).toBeCloseTo(s.x, 6);
    expect(st.pose.p[2]).toBeCloseTo(s.z, 6);
    if (st.shape.type !== 'box') throw new Error('box statics only');
    const [hx, hy, hz] = st.shape.half;
    expect(2 * hx).toBeCloseTo(s.w, 1);
    expect(2 * hz).toBeCloseTo(s.d, 1);
    if (s.fill === 'clay') expect(2 * hy).toBeCloseTo(s.h, 6);
    // yaw: the body's quaternion turns about +Y by the spot's yaw (the phone's body is square to the bench; only its drawing turns)
    const yaw = 2 * Math.atan2(st.pose.q[1], st.pose.q[3]);
    if (key !== 'phone') expect(yaw).toBeCloseTo((s.yaw * Math.PI) / 180, 6);
  });

  it('puts the belt piece round its bed and motor, the stack and the lane where the simulation has them', () => {
    const b = spotBox(S.belt);
    for (const id of ['belt-bed', 'belt-motor']) {
      const k = body(id);
      expect(b.min.x, id).toBeLessThanOrEqual(k.min.x + 1e-6);
      expect(b.max.x, id).toBeGreaterThanOrEqual(k.max.x - 1e-6);
      expect(b.min.z, id).toBeLessThanOrEqual(k.min.z + 0.2);
      expect(b.max.z, id).toBeGreaterThanOrEqual(k.max.z - 1e-6);
    }
    // the real piece at the bench's length fits its spot
    const pb = pieceBounds(belt({ length: LAYOUT.beltLength, detail: 'low' }));
    const at = fit.belt.at;
    expect(at.x + pb.min.x).toBeGreaterThanOrEqual(b.min.x - 0.02);
    expect(at.x + pb.max.x).toBeLessThanOrEqual(b.max.x + 0.02);
    expect([S.stack.x, S.stack.z]).toEqual([...AT.stack]);
    expect(S.lane.x).toBeCloseTo((AT.lane.a[0] + AT.lane.b[0]) / 2, 6);
    expect(S.lane.z).toBeCloseTo(AT.lane.a[1], 6);
    expect(S.lane.w).toBeCloseTo(AT.lane.b[0] - AT.lane.a[0] + 2 * LANE_TAPE.past, 6);
    expect(S.lane.d).toBeCloseTo(2 * LANE_TAPE.half, 6);
  });

  it('keeps the bench 18 × 10 in both tables', () => {
    expect(LAYOUT.bench).toEqual(AT.bench);
    expect(scene.bench.maxX - scene.bench.minX).toBe(18);
    expect(scene.bench.maxZ - scene.bench.minZ).toBe(10);
  });
});

describe('the footprints', () => {
  const onBench = (Object.entries(S) as Array<[StationKey, Spot]>).filter(([, s]) => s.z > -5);
  /** Overlaps that are meant: the striker's post stands on the belt's far rail; the stool tucks against the board's frame post; Revert parks on its hatch; the dock's mouth meets the belt's end (its turned footprint's box overlaps). */
  const MEANT = new Set(['striker|belt', 'board|stool', 'hatch|revert', 'belt|dock']);
  // the real pieces' footprints are their bounds (the platen's conduit, the storefront's jack box, the dock's ramp included)
  it('lie on the bench and do not overlap (except where one stands on another)', () => {
    for (const [k, s] of onBench) {
      const b = spotBox(s);
      expect(b.min.x, k).toBeGreaterThanOrEqual(LAYOUT.bench.minX);
      expect(b.max.x, k).toBeLessThanOrEqual(LAYOUT.bench.maxX);
      expect(b.min.z, k).toBeGreaterThanOrEqual(LAYOUT.bench.minZ);
      expect(b.max.z, k).toBeLessThanOrEqual(LAYOUT.bench.maxZ);
    }
    for (let i = 0; i < onBench.length; i++)
      for (let j = i + 1; j < onBench.length; j++) {
        const [ka, sa] = onBench[i]!, [kb, sb] = onBench[j]!;
        if (MEANT.has(`${ka}|${kb}`) || MEANT.has(`${kb}|${ka}`)) continue;
        const a = spotBox(sa), b = spotBox(sb);
        // footprints only (x, z); the dock's turned footprint is tested as its bounding box, a little generous
        const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x), oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
        expect(ox > 1e-6 && oz > 1e-6 ? `${ka} overlaps ${kb}` : null).toBe(null);
      }
  });

  it('keep the centre cluster (Button, loose crate, phone, Patch) inside the middle 40% of the bench', () => {
    const span = (scene.bench.maxX - scene.bench.minX) * 0.4;
    for (const [name, b] of Object.entries(cluster())) {
      expect(b.min.x, name).toBeGreaterThanOrEqual(-span / 2);
      expect(b.max.x, name).toBeLessThanOrEqual(span / 2);
    }
  });

  it('flow left to right: stack, belt, striker, dock; the storefront right of the platen', () => {
    expect(S.stack.x).toBeLessThan(S.belt.x);
    expect(S.striker.x).toBeGreaterThan(S.belt.x);
    expect(S.dock.x).toBeGreaterThan(S.striker.x);
    expect(S.storefront.x).toBeGreaterThan(S.platen.x);
  });

  it('seat Patch beside the board, past its right end', () => {
    expect(fit.stool.seat[0]).toBeGreaterThan(body('board').max.x);
  });
});

describe("Fetch's lane", () => {
  const FETCH_HALF: Vec3 = defaultHalfExtents('robot', 'M');
  const S_HALF: Vec3 = defaultHalfExtents('crate', 'S');
  const statics = scene.statics.filter((s) => s.id !== 'bench' && s.id !== 'back-wall').map((s) => [s.id, body(s.id)] as const);
  const overlap = (a: Box3, b: Box3): number => Math.min(a.max.x - b.min.x, b.max.x - a.min.x, a.max.y - b.min.y, b.max.y - a.min.y, a.max.z - b.min.z, b.max.z - a.min.z);

  it('lets Fetch and the crate in its hands run the whole lane, overshoot included, clear of every body', () => {
    const [ax, az] = AT.lane.a;
    const [bx] = AT.lane.b;
    // Fetch drawn at the crew's scale: its body and its reach grow with it (the crate does not)
    const k = CREW_SCALE;
    const reach = (FETCH_TUNING.bodyHalfDepth + FETCH_TUNING.handGap) * k + S_HALF[2];
    const half: Vec3 = [FETCH_HALF[0] * k, FETCH_HALF[1] * k, FETCH_HALF[2] * k];
    let closest = Infinity;
    let along = Infinity;
    for (let i = 0; i <= 200; i++) {
      const x = ax + ((bx - ax) * i) / 200;
      // running along the lane (±X): body and crate; facing the visitor (+Z): the crate reaches toward the belt
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1]] as const) {
        const hx = dx ? half[2] : half[0], hz = dx ? half[0] : half[2];
        const bodyB = new Box3(new Vector3(x - hx, 0, az - hz), new Vector3(x + hx, 2 * half[1], az + hz));
        const c = new Vector3(x + dx * reach, FETCH_TUNING.handHeight * k, az + dz * reach);
        const crate = new Box3(c.clone().sub(new Vector3(...S_HALF)), c.clone().add(new Vector3(...S_HALF)));
        for (const [id, b] of statics)
          for (const it of [bodyB, crate]) {
            const d = overlap(it, b);
            expect(d, `at x ${x.toFixed(2)} facing (${dx}, ${dz}): ${id}`).toBeLessThan(0);
            closest = Math.min(closest, -d);
            if (dx && -d < along) {
              along = -d;
              if (process.env['BENCH_REPORT']) console.log(`ALONG ${along.toFixed(3)} ${id} x ${x.toFixed(2)} dx ${dx}`);
            }
          }
      }
    }
    // running along the lane it keeps 0.3 from everything; facing the visitor, the crate comes nearest the belt's bed
    expect(along).toBeGreaterThan(0.3);
    expect(closest).toBeGreaterThan(0.1);
  });

  it("keeps the lane's tape off every body's footprint", () => {
    const tape = new Box3(new Vector3(AT.lane.a[0] - LANE_TAPE.past, 0, AT.lane.a[1] - LANE_TAPE.half), new Vector3(AT.lane.b[0] + LANE_TAPE.past, 0.001, AT.lane.a[1] + LANE_TAPE.half));
    for (const [id, b] of statics) {
      const foot = new Box3(new Vector3(b.min.x, 0, b.min.z), new Vector3(b.max.x, 0.001, b.max.z));
      expect(tape.intersectsBox(foot) && !(tape.max.z <= foot.min.z || foot.max.z <= tape.min.z) ? `tape under ${id}` : null).toBe(null);
    }
  });
});

describe('the camera homes', () => {
  it.each([
    [1440, 900],
    [1920, 1080],
    [1280, 720],
  ])('shows everything usable at %i×%i: every station and the bench front to the sign hook', (w, h) => {
    const rig = rigAt(w, h);
    for (const [k, s] of Object.entries(S)) expect(inFrame(rig, corners(spotBox(s))), k).toBe(true);
    for (const p of MUST_SEE) expect(inFrame(rig, [new Vector3(...p)]), p.join(',')).toBe(true);
  });

  it('shows the centre cluster on an upright phone (390×844) without panning', () => {
    const rig = rigAt(390, 844);
    for (const [name, b] of Object.entries(cluster())) expect(inFrame(rig, corners(b)), name).toBe(true);
  });

  it('hides nothing usable behind anything else from the fixed camera', () => {
    const rig = rigAt(1440, 900);
    const eye = rig.camera.position.clone();
    const top = (k: StationKey, f = 1): Vec3 => {
      const b = spotBox(S[k]);
      const c = b.getCenter(new Vector3());
      return [c.x, b.min.y + (b.max.y - b.min.y) * f, b.max.z - 0.05];
    };
    /** A real piece's sockets, placed at its spot's origin: what a visitor must see of it. */
    const sockets = (k: StationKey, p: { sockets?: Record<string, Matrix4> }, names: readonly string[]): Record<string, Vec3> => {
      const o = S[k].at!;
      const out: Record<string, Vec3> = {};
      for (const n of names) {
        const m = p.sockets?.[n];
        if (!m) throw new Error(`${k}: no socket ${n}`);
        const v = new Vector3().setFromMatrixPosition(m);
        out[`${k} ${n}`] = [v.x + o[0], v.y, v.z + o[1]];
      }
      return out;
    };
    const targets: Record<string, Vec3> = {
      'button cap': scene.button.at,
      ...Object.fromEntries(scene.cord.jacks.map((j) => [j.id, j.at])),
      phone: top('phone', 0.75),
      'patch head': [fit.stool.seat[0], fit.stool.seat[1] + 0.9 * CREW_SCALE, fit.stool.seat[2]],
      'stack top': scene.parts.find((p) => p.id === scene.button.stack[2])!.pose.p,
      'loose crate': REST,
      'undo lever': top('undo', 0.9),
      platen: top('platen', 0.9),
      'storefront front': top('storefront', 0.5),
      'striker head': top('striker', 0.95),
      'dock mouth': [S.dock.x - 0.4, 0.8, S.dock.z + 0.3],
      'belt dial and lever (on its motor)': [S.belt.x - S.belt.w / 2 + 0.6, 0.9, S.belt.z + S.belt.d / 2 - 0.1],
      mailbox: [MAILBOX.x, MAILBOX.postH + 0.15, MAILBOX.z + 0.17],
      'résumé clipboard': [MAILBOX.x, MAILBOX.clipboard.y + 0.2, MAILBOX.z + 0.15],
      'mailbox foot': [MAILBOX.x, 0.1, MAILBOX.z + 0.1],
      ...sockets('platen', platen({ detail: 'low' } as never), ['seat', 'plate', 'jack', 'lamp', 'tapehead.face']),
      ...sockets('storefront', storefront({ detail: 'low' } as never), ['words', 'window', 'jack', 'lamp']),
      ...sockets('dock', dock({ detail: 'low', reach: DOCK_REACH }), ['door', 'threshold', 'bell', 'lamp', 'in']),
      'revert top': top('revert', 1),
      'return chute': top('chute', 0.9),
      "revert's hatch": [S.hatch.x, 0.05, S.hatch.z],
      'RESERVED label': [S.bayNext.x, 0.01, S.bayNext.z + S.bayNext.d / 2 - 0.4],
      'INSPECTION label': [S.bayInspection.x, 0.01, S.bayInspection.z + S.bayInspection.d / 2 - 0.4],
    };
    // every shipped crate's front: its middle and a hand's breadth above its foot
    shippedCrateFronts().forEach((f, i) => {
      targets[`shipped crate ${i}`] = [f.c.x, f.c.y, f.c.z + 0.01];
      targets[`shipped crate ${i} foot`] = [f.c.x, f.c.y - f.h / 2 + 0.06, f.c.z + 0.01];
    });
    // oriented boxes: each static in its own frame (the dock's portal and bay turn -50°), the ray taken into it
    const blockers = scene.statics
      .filter((s) => s.id !== 'bench' && s.id !== 'back-wall' && s.shape.type === 'box')
      .map((s) => {
        const half = (s.shape as { half: Vec3 }).half;
        const inv = new Quaternion(...s.pose.q).invert();
        return { id: s.id, c: new Vector3(...s.pose.p), inv, box: new Box3(new Vector3(-half[0], -half[1], -half[2]), new Vector3(...half)) };
      });
    for (const [name, t] of Object.entries(targets)) {
      const to = new Vector3(...t);
      const dist = eye.distanceTo(to);
      for (const b of blockers) {
        const o = eye.clone().sub(b.c).applyQuaternion(b.inv), p = to.clone().sub(b.c).applyQuaternion(b.inv);
        if (b.box.clone().expandByScalar(0.08).containsPoint(p)) continue; // its own body
        const hit = new Ray(o, p.clone().sub(o).normalize()).intersectBox(b.box, new Vector3());
        if (hit && o.distanceTo(hit) < dist - 0.05 && process.env["BENCH_REPORT"]) console.log("HIDDEN", name, b.id, JSON.stringify(to), JSON.stringify(eye), JSON.stringify(hit.clone().applyQuaternion(b.inv.clone().invert()).add(b.c)));
        expect(hit && o.distanceTo(hit) < dist - 0.05 ? `${name} hidden by ${b.id}` : null).toBe(null);
      }
    }
  });
});

describe('the frame at 1440×900', () => {
  it('shows both front corners inside the sides and the apron and the dark under the front edge', () => {
    const rig = rigAt(1440, 900);
    const px = (p: Vector3) => {
      const s = rig.worldToScreen(p);
      return { x: ((s.x + 1) / 2) * 1440, y: ((1 - s.y) / 2) * 900 };
    };
    const l = px(new Vector3(-9, 0, 5)), r = px(new Vector3(9, 0, 5)), e = px(new Vector3(0, 0, 5));
    expect(l.x).toBeGreaterThanOrEqual(FRAME_PX.corners - 5);
    expect(1440 - r.x).toBeGreaterThanOrEqual(FRAME_PX.corners - 5);
    expect(900 - e.y).toBeGreaterThanOrEqual(FRAME_PX.under[0]);
    expect(900 - e.y).toBeLessThanOrEqual(FRAME_PX.under[1]);
  });
});

describe('Patch at the crew scale', () => {
  const stub: Materials = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial(), update() {}, dispose() {} };
  const seated = (arms: 'rest' | 'reach', k = CREW_SCALE): Object3D => {
    const o: Object3D = K.realize(patchFelt({}), stub);
    o.position.set(...fit.stool.seat);
    o.rotation.y = SIDE_ON;
    o.scale.setScalar(k);
    posePatch(o, { arms });
    o.updateMatrixWorld(true);
    return o;
  };
  it("keeps its head under the board's crest and its reaching paw above the jack row (the staging lowers it with a lean)", () => {
    for (const k of [1, 1.25, 1.4, 1.5]) {
      const r = seated('rest', k), q = seated('reach', k);
      const head = r.getObjectByName('head')!;
      if (process.env['BENCH_REPORT']) console.log(`PATCH ${k}: top ${new Box3().setFromObject(r).max.y.toFixed(2)} head ${head.getWorldPosition(new Vector3()).y.toFixed(2)} paw(reach) ${q.getObjectByName('pawL')!.getWorldPosition(new Vector3()).y.toFixed(2)} paw(rest) ${r.getObjectByName('pawL')!.getWorldPosition(new Vector3()).y.toFixed(2)}`);
    }
    // the head (its pivot, the middle of the skull) stays under the crest; at 1.5× the ear tips and headset do not (reported)
    const o = seated('reach');
    const head = seated('rest').getObjectByName('head')!.getWorldPosition(new Vector3());
    expect(head.y).toBeLessThan(body('board').max.y);
    const paw = o.getObjectByName('pawL')!.getWorldPosition(new Vector3());
    expect(paw.y).toBeGreaterThan(AT.jacks.lamp[1]);
  });
});

describe('the Shipped zone', () => {
  it('stands its pallets, crates and mailbox inside its footprint, as the simulation has them', () => {
    const z = spotBox(S.shipped);
    expect(z.intersectsBox(mailboxBox())).toBe(false);
    for (const { id, box } of shippedBoxes()) {
      expect(z.containsBox(new Box3(box.min.clone().setY(0), box.max.clone().setY(0))), id).toBe(true);
      const b = body(id);
      expect(b.min.distanceTo(box.min), id).toBeLessThan(1e-6);
      expect(b.max.distanceTo(box.max), id).toBeLessThan(1e-6);
    }
    expect(SHIPPED.pallets.length).toBe(4);
    for (const p of SHIPPED.pallets) expect(p.crates.length).toBeGreaterThanOrEqual(2);
    const m = body('mailbox'), mb = mailboxBox();
    expect(m.min.distanceTo(mb.min)).toBeLessThan(1e-6);
    expect(m.max.distanceTo(mb.max)).toBeLessThan(1e-6);
  });
});

describe('the real pieces', () => {
  const near = (a: number, b: number, tol = 0.02): boolean => Math.abs(a - b) <= tol;
  it.each([
    ['storefront', () => storefront({ detail: 'low' } as never), 1],
    ['platen', () => platen({ detail: 'low' } as never), 1],
    ['dock', () => dock({ detail: 'low', reach: DOCK_REACH }), 1],
    ['revert', () => revert({ detail: 'low', pose: 'idle' } as never), REVERT_SCALE],
    ['hatch', () => revertHatch({ detail: 'low', pose: 'open' } as never), REVERT_SCALE],
  ] as const)('%s stands in its spot (the layout carries its real bounds)', (key, make, k) => {
    const b = pieceBounds(make());
    const B = BOUNDS[key];
    expect(near(b.min.x * k, B.x[0]) && near(b.max.x * k, B.x[1]) && near(b.min.z * k, B.z[0]) && near(b.max.z * k, B.z[1]) && near(b.max.y * k, B.h, 0.03), `${key}: ${b.min.x * k}..${b.max.x * k}, ${b.min.z * k}..${b.max.z * k}, h ${b.max.y * k}`).toBe(true);
  });

  it("fits the dock's ramp to the belt's bed end", () => {
    const d = S.dock.at!;
    // bed end plus the gap, at the ramp's start
    expect(d[0] + DOCK_REACH[0] - 0.12).toBeCloseTo(AT.belt.c[0] + AT.belt.half[0], 6);
    expect(d[1] + DOCK_REACH[1]).toBeCloseTo(AT.belt.c[2], 6);
  });
  it("keeps every real piece's bodies inside its footprint", () => {
    const inside = (id: string, k: StationKey): void => {
      const s = scene.statics.find((q) => q.id === id)!;
      const half = (s.shape as { half: Vec3 }).half;
      const q = new Quaternion(...s.pose.q);
      const f = spotBox(S[k]).expandByScalar(0.05);
      for (const c of corners(new Box3(new Vector3(-half[0], -half[1], -half[2]), new Vector3(...half)))) expect(f.containsPoint(c.applyQuaternion(q).add(new Vector3(...s.pose.p))), `${id} in ${k}`).toBe(true);
    };
    inside('platen', 'platen');
    inside('platen-column', 'platen');
    inside('platen-tank', 'platen');
    inside('storefront', 'storefront');
    inside('dock', 'dock');
    inside('revert', 'revert');
  });
});

describe('the station files', () => {
  it('are found by name: each exports a station with a unique name, in an order the set and the crew rely on', async () => {
    const all = await benchStations();
    const names = all.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const want of ['set', 'parts', 'fetch', 'patch', 'board', 'belt', 'button']) expect(names, want).toContain(want);
    const at = (n: string): number => names.indexOf(n);
    // whatever feeds the set's pool comes before it; Fetch after the parts
    for (const s of all) if (s.order < ORDER.set) expect(at(s.name), s.name).toBeLessThan(at('set'));
    expect(at('fetch')).toBeGreaterThan(at('parts'));
  });
});

describe('the sign and the clean-up', () => {
  it('reads the whole name, one panel a word, from the content', () => {
    expect(SIGN_WORDS.length).toBe(2);
    for (const w of SIGN_WORDS) expect(w).toBe(w.toUpperCase());
  });

  it('has retired the bulb Fetch and the toy Patch', () => {
    const f = pieceFolders();
    expect(f).not.toContain('fetch-bulb');
    expect(f).not.toContain('patch-toy');
    expect(f).toContain('fetch-porter');
    expect(f).toContain('patch-felt');
  });
});
