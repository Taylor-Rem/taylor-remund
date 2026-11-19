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
import { benchStations, ORDER, CHUTE_AIM, CHUTE_RUN, BOUNDS, CREW_SCALE, DOCK_REACH, FRAMING, FRAME_PX, LANE_TAPE, LAYOUT, MAILBOX, MUST_SEE, REVERT_SCALE, SIGN_WORDS, homeBox, homeEdge, mailboxBox, shippedBoxes, shippedCrateFronts, SHIPPED, spotBox, type Spot, type StationKey } from '../../../src/workshop/view/bench.ts';
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
import { CRATE_EDGE, defaultHalfExtents } from '../../../src/workshop/sim/parts.ts';
import { FETCH_TUNING } from '../../../src/workshop/sim/crew/fetch.ts';
import { pieceFolders } from '../../../src/workshop/view/kit/pieces/registry.ts';
import { switchboard, stool } from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import { belt } from '../../../src/workshop/view/kit/pieces/belt/index.ts';
import { pieceBounds } from '../../../src/workshop/view/kit/compose.ts';
import { undoLever } from '../../../src/workshop/view/kit/pieces/undo-lever/index.ts';
import { striker } from '../../../src/workshop/view/kit/pieces/striker/index.ts';
import { chute } from '../../../src/workshop/view/kit/pieces/chute/index.ts';
import { JACKS, BOARD_WHOLE, STOOL_SEAT } from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import { LINE } from '../../../src/workshop/sim/scenes/bench.ts';
import { lanePath, laneOutline } from '../../../src/workshop/sim/path.ts';
import { canRunLap, fetchStand } from '../../../src/workshop/sim/crew/fetch.ts';
import { reachFrom, type V3 } from '../../../src/workshop/view/kit/pieces/fetch-porter/reach.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

const S = LAYOUT.stations as Record<StationKey, Spot>;
const body = (id: string): Box3 => {
  const b = staticBox(scene, id);
  if (!b) throw new Error(`no static ${id}`);
  return b;
};
const fit = fitPieces(scene, { board: switchboard({ detail: 'low', jacks: JACKS }), stool: stool({ detail: 'low', seatY: STOOL_SEAT }), belt: belt({ length: LAYOUT.beltLength, detail: 'low', line: true }) }, { stool: { x: S.stool.x, z: S.stool.z }, phoneYaw: S.phone.yaw });

/** Where the fumbled crate comes to rest: tossed ahead and back off the front run, just past its left end, in front of the UNDO lever (about; the simulation decides: (-3.11, 2.80) in the attract test's first lap). */
const REST: Vec3 = [AT.lane.points[0]![0] - 0.5, 0.225, AT.lane.points[0]![1]];
/** The loose crate at the start: the first thing to pick up, in front of the Button's console. */
const FIRST: Vec3 = AT.firstCrate;
/** Patch, drawn at the crew's scale on its seat: its seated box. */
const patchBox = (): Box3 => {
  const s = fit.stool.seat;
  return new Box3(new Vector3(s[0] - 0.35 * CREW_SCALE, s[1], s[2] - 0.3 * CREW_SCALE), new Vector3(s[0] + 0.35 * CREW_SCALE, s[1] + 1.1 * CREW_SCALE, s[2] + 0.3 * CREW_SCALE));
};
function cluster(): Record<string, Box3> {
  return {
    button: body('console').expandByVector(new Vector3(0, 0.45, 0)),
    crate: new Box3(new Vector3(FIRST[0] - 0.25, 0, FIRST[2] - 0.25), new Vector3(FIRST[0] + 0.25, 0.45, FIRST[2] + 0.25)),
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
    ['stool', 'stool'], ['phone', 'phone'], ['button', 'console'], ['undo', 'undo'],
  ];
  it.each(bodies)('%s stands where its body is', (key, id) => {
    const s = S[key];
    // Revert is a loose part since S4 (it can be picked up): its body starts on its hatch
    const part = scene.parts.find((q) => q.id === id && q.half);
    const st = scene.statics.find((q) => q.id === id) ?? (part ? { id, shape: { type: 'box' as const, half: part.half! }, pose: part.pose } : undefined)!;
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
    const pb = pieceBounds(belt({ length: LAYOUT.beltLength, detail: 'low', line: true }));
    const at = fit.belt.at;
    expect(at.x + pb.min.x).toBeGreaterThanOrEqual(b.min.x - 0.02);
    expect(at.x + pb.max.x).toBeLessThanOrEqual(b.max.x + 0.02);
    expect([S.stack.x, S.stack.z]).toEqual([...AT.stack]);
    // the lane's spot is the box round its path, the tape's width included
    const xs = AT.lane.points.map((q) => q[0]), zs = AT.lane.points.map((q) => q[1]);
    const lb = spotBox(S.lane);
    expect(lb.min.x).toBeLessThanOrEqual(Math.min(...xs) - LANE_TAPE.past + 1e-6);
    expect(lb.max.x).toBeGreaterThanOrEqual(Math.max(...xs) + LANE_TAPE.past - 1e-6);
    expect(lb.min.z).toBeLessThanOrEqual(Math.min(...zs) - LANE_TAPE.half + 1e-6);
    expect(lb.max.z).toBeGreaterThanOrEqual(Math.max(...zs) + LANE_TAPE.half - 1e-6);
  });

  it("clamps the lamp where the simulation's lamp has its shoulder", () => {
    expect([S.lamp.x, S.lamp.z]).toEqual([...AT.lamp]);
  });

  it('keeps the bench 18 × 10 in both tables', () => {
    expect(LAYOUT.bench).toEqual(AT.bench);
    expect(scene.bench.maxX - scene.bench.minX).toBe(18);
    expect(scene.bench.maxZ - scene.bench.minZ).toBe(10);
  });
});

describe('the footprints', () => {
  const onBench = (Object.entries(S) as Array<[StationKey, Spot]>).filter(([, s]) => s.z > -5);
  /**
   * Overlaps that are meant: the striker's arm reaches over the belt; the stool stands on the board's runner; Revert parks on its
   * hatch; the dock's mouth meets the belt's end, and its turned footprint's box (the ramp's straight run included) reaches over the
   * lane's right end, which stops clear of its portal (the oriented test below); the chute's footprint box takes in the corner by
   * the belt's motor housing (its duct passes behind it); the stack stands at today's platen's front-left corner, over the
   * conduit that leaves its jack plate (the reshaped piece's footprint ends at its left foot, 0.1 right of the stack); the dock's
   * turned footprint's box reaches back over today's platen's front-right corner (its portal is clear of it: the oriented test).
   */
  const MEANT = new Set(['striker|belt', 'board|stool', 'hatch|revert', 'belt|dock', 'chute|belt', 'platen|stack', 'platen|dock']);
  /** The lane is a path of runs, not a box: its tape is held off every body, run by run, below. */
  const SKIP = new Set(['lane']);
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
        if (MEANT.has(`${ka}|${kb}`) || MEANT.has(`${kb}|${ka}`) || SKIP.has(ka) || SKIP.has(kb)) continue;
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

  it('flow left to right: the feed, the striker, the dock; the storefront right of the platen', () => {
    expect(AT.beltFeed).toBeLessThan(LINE.strikerX);
    expect(S.striker.x).toBeGreaterThan(S.belt.x);
    expect(S.dock.x).toBeGreaterThan(S.striker.x);
    expect(S.storefront.x).toBeGreaterThan(S.platen.x);
  });

  it('seat Patch beside the board, past its right end', () => {
    expect(fit.stool.seat[0]).toBeGreaterThan(body('board').max.x);
  });
});

describe("Fetch's path (A1 round 7: runs of tape, corners rounded, a stand at an end taken exactly)", () => {
  const FETCH_HALF: Vec3 = defaultHalfExtents('robot', 'M');
  const S_HALF: Vec3 = defaultHalfExtents('crate', 'S');
  const statics = scene.statics.filter((s) => s.id !== 'bench' && s.id !== 'back-wall').map((s) => [s.id, body(s.id)] as const);
  const overlap = (a: Box3, b: Box3): number => Math.min(a.max.x - b.min.x, b.max.x - a.min.x, a.max.y - b.min.y, b.max.y - a.min.y, a.max.z - b.min.z, b.max.z - a.min.z);
  const k = CREW_SCALE;
  const PTS = AT.lane.points as readonly (readonly [number, number])[];
  const path = lanePath(PTS, FETCH_TUNING.cornerRadius * k);
  const runs = PTS.slice(1).map((b, i) => ({ a: PTS[i]!, b, len: Math.hypot(b[0] - PTS[i]![0], b[1] - PTS[i]![1]) }));

  it("keeps to its engineer's rules: runs at least 0.9 between corners, straight for a corner's tangent and 0.25 more into an end, turns of 135° or less, parallel runs 1.4 apart", () => {
    // a right angle's tangent (S5 round 3: a 0.44 run arrived still turning and clipped the platen)
    const tangent = FETCH_TUNING.cornerRadius * k;
    runs.forEach((r, i) => expect(r.len, `run ${i}`).toBeGreaterThanOrEqual(i === 0 || i === runs.length - 1 ? tangent + 0.25 : 0.9));
    for (const c of path.corners) expect(c.turn).toBeLessThanOrEqual((135 * Math.PI) / 180 + 1e-9);
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 2; j < runs.length; j++) {
        const a = runs[i]!, b = runs[j]!;
        const ua = [(a.b[0] - a.a[0]) / a.len, (a.b[1] - a.a[1]) / a.len], ub = [(b.b[0] - b.a[0]) / b.len, (b.b[1] - b.a[1]) / b.len];
        if (Math.abs(ua[0]! * ub[1]! - ua[1]! * ub[0]!) > 1e-6) continue;
        // parallel: their distance apart
        expect(Math.abs((b.a[0] - a.a[0]) * -ua[1]! + (b.a[1] - a.a[1]) * ua[0]!), `runs ${i} and ${j}`).toBeGreaterThanOrEqual(1.4);
      }
  });

  it('lets Fetch and the crate in its hands ride the whole path to its very ends (nothing carries it past one), clear of every body', () => {
    const reach = (FETCH_TUNING.bodyHalfDepth + FETCH_TUNING.handGap) * k + S_HALF[2];
    const half: Vec3 = [FETCH_HALF[0] * k, FETCH_HALF[1] * k, FETCH_HALF[2] * k];
    let along = Infinity;
    for (let i = 0; i <= 400; i++) {
      const s = (path.length * i) / 400;
      const [x, z] = path.at(s);
      const yaw = path.yaw(s);
      const ux = Math.sin(yaw), uz = Math.cos(yaw);
      // the body as a box round its turned footprint; the crate held ahead of it, either way along the path
      const hx = Math.abs(ux) * half[2] + Math.abs(uz) * half[0], hz = Math.abs(uz) * half[2] + Math.abs(ux) * half[0];
      const bodyB = new Box3(new Vector3(x - hx, 0, z - hz), new Vector3(x + hx, 2 * half[1], z + hz));
      for (const sgn of [1, -1]) {
        const c = new Vector3(x + sgn * ux * reach, FETCH_TUNING.handHeight * k, z + sgn * uz * reach);
        const crate = new Box3(c.clone().sub(new Vector3(...S_HALF)), c.clone().add(new Vector3(...S_HALF)));
        for (const [id, b] of statics)
          for (const it of [bodyB, crate]) {
            const d = overlap(it, b);
            expect(d, `at s ${s.toFixed(2)} (${x.toFixed(2)}, ${z.toFixed(2)}): ${id}`).toBeLessThan(0);
            along = Math.min(along, -d);
          }
      }
    }
    if (process.env['BENCH_REPORT']) console.log(`PATH nearest body ${along.toFixed(3)}`);
  });

  it("keeps the path's tape off every body's footprint", () => {
    const pts = laneOutline(PTS, LANE_TAPE.half, LANE_TAPE.past);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    // each run's band of tape as a box (the outline's runs are axis-aligned here)
    runs.forEach((r, i) => {
      // across the run: half the tape's width; along it: the overrun at the path's ends, half the width at a corner
      const ux = Math.abs(r.b[0] - r.a[0]) / r.len, uz = Math.abs(r.b[1] - r.a[1]) / r.len;
      const ea = i === 0 ? LANE_TAPE.past : LANE_TAPE.half, eb = i === runs.length - 1 ? LANE_TAPE.past : LANE_TAPE.half;
      const ax = r.a[0] <= r.b[0] ? ea : eb, bx = r.a[0] <= r.b[0] ? eb : ea, az = r.a[1] <= r.b[1] ? ea : eb, bz = r.a[1] <= r.b[1] ? eb : ea;
      const lo = [Math.min(r.a[0], r.b[0]) - (ux ? ax : LANE_TAPE.half), Math.min(r.a[1], r.b[1]) - (uz ? az : LANE_TAPE.half)];
      const hi = [Math.max(r.a[0], r.b[0]) + (ux ? bx : LANE_TAPE.half), Math.max(r.a[1], r.b[1]) + (uz ? bz : LANE_TAPE.half)];
      const tape = new Box3(new Vector3(lo[0], 0, lo[1]), new Vector3(hi[0], 0.001, hi[1]));
      for (const [id, b] of statics) {
        const foot = new Box3(new Vector3(b.min.x, 0, b.min.z), new Vector3(b.max.x, 0.001, b.max.z));
        const ox = Math.min(tape.max.x, foot.max.x) - Math.max(tape.min.x, foot.min.x), oz = Math.min(tape.max.z, foot.max.z) - Math.max(tape.min.z, foot.min.z);
        expect(ox > 1e-6 && oz > 1e-6 ? `tape under ${id}` : null).toBe(null);
      }
    });
    expect(Math.min(...xs)).toBeGreaterThan(LAYOUT.bench.minX);
    expect(Math.max(...zs)).toBeLessThan(LAYOUT.bench.maxZ);
  });

  it('keeps off Revert\'s hatch and its doors\' swing, and never waits in front of it; Revert on its hatch clears the stack by 0.2', () => {
    const hatch = spotBox(S.hatch);
    const pad = Math.hypot(FETCH_HALF[0], FETCH_HALF[2]) * k;
    for (let i = 0; i <= 200; i++) {
      const [x, z] = path.at((path.length * i) / 200);
      const dx = Math.max(0, hatch.min.x - x, x - hatch.max.x), dz = Math.max(0, hatch.min.z - z, z - hatch.max.z);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(pad);
    }
    const rev = (scene.parts.find((p) => p.id === 'revert')!.half ?? [0, 0, 0]) as Vec3;
    const rx = AT.revert.c[0], rz = AT.revert.c[2];
    const sx = Math.max(0, AT.stack[0] - 0.4 - (rx + rev[0]), rx - rev[0] - (AT.stack[0] + 0.4)), sz = Math.max(0, AT.stack[1] - 0.4 - (rz + rev[2]), rz - rev[2] - (AT.stack[1] + 0.4));
    expect(Math.hypot(sx, sz)).toBeGreaterThanOrEqual(0.2);
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
      'stack top': scene.parts.find((p) => p.id === scene.button.stack[scene.button.stack.length - 1])!.pose.p,
      'stack bottom': [AT.stack[0], 0.15, AT.stack[1] + 0.4],
      'fumbled crate': REST,
      'first crate': AT.firstCrate,
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
    expect(head.y).toBeLessThan(body('board-panel').max.y);
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
    ['board', () => switchboard({ detail: 'low', jacks: JACKS }), 1],
    ['undo', () => undoLever({ detail: 'low' } as never), 1],
    ['striker', () => striker({ detail: 'low' } as never), 1],
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
    // Revert is a loose part since S4, not a static (its home on the hatch is checked above)
    inside('board', 'board');
    inside('undo', 'undo');
  });

  it('stands the chute at the front-left corner, what is on the bench inside its spot, its riser outside the edge', () => {
    const b = pieceBounds(chute({ detail: 'low', run: CHUTE_RUN, aim: CHUTE_AIM }));
    const B = BOUNDS.chute;
    expect(b.min.x).toBeCloseTo(B.x[0], 2);
    expect(b.max.x).toBeCloseTo(B.x[1], 2);
    expect(b.min.z).toBeCloseTo(B.z[0], 2);
    expect(b.max.y).toBeCloseTo(B.h, 2);
    expect(S.chute.at![1]).toBe(LAYOUT.bench.maxZ);
  });

  it("puts the striker's hammer where the simulation strikes (LINE.strikerX) and over the belt's middle line", () => {
    const p = striker({ detail: 'low' } as never);
    const h = new Vector3().setFromMatrixPosition(p.sockets!['hammer']!);
    const [ox, oz] = S.striker.at!;
    expect(ox + h.x).toBeCloseTo(LINE.strikerX, 2);
    expect(oz + h.z).toBeCloseTo(AT.belt.c[2], 2);
    // the striker's body holds the post, and stands behind the belt (the arm and hammer over it are no body)
    const post = body('striker');
    expect(post.min.x).toBeLessThanOrEqual(ox - 0.15);
    expect(post.max.x).toBeGreaterThanOrEqual(ox + 0.15);
    expect(post.max.z).toBeLessThan(AT.belt.c[2] - AT.belt.half[2]);
    // far enough from the belt's far end for a run of notes played backwards (§ B2 X2): three crates' room
    expect(AT.belt.c[0] + AT.belt.half[0] - LINE.strikerX).toBeGreaterThanOrEqual(1.5 - 1e-9);
  });

  it("stands the whole board against the wall, its jacks where the simulation has them, the stool on its runner's right end", () => {
    const p = switchboard({ detail: 'low', jacks: JACKS });
    const [bx, bz] = S.board.at!;
    const w = (n: string): Vector3 => new Vector3().setFromMatrixPosition(p.sockets![n]!).add(new Vector3(bx, 0, bz));
    for (const k of ['storefront', 'platen', 'belt', 'lamp'] as const) {
      const j = w(`jack.${k}`);
      expect(j.distanceTo(new Vector3(...AT.jacks[k])), k).toBeLessThan(0.01);
      const st = w(`stool.${k}`);
      expect(Math.hypot(st.x - AT.stoolAt[k][0], st.z - AT.stoolAt[k][1]), `stool.${k}`).toBeLessThan(0.01);
    }
    // the capped jacks on the live row's line, at the board's layout
    BOARD_WHOLE.capped.forEach((x, i) => expect(new Vector3(...AT.jacks[i ? 'reserved2' : 'reserved1']).distanceTo(new Vector3(bx + x, AT.jacks.lamp[1], AT.jacks.lamp[2]))).toBeLessThan(0.01));
    // the keyshelf point is on the desk's top, inside the shelf and left of the writing ledge
    const desk = body('board');
    expect(AT.keyshelf[1]).toBeCloseTo(desk.max.y, 2);
    expect(AT.keyshelf[2]).toBeGreaterThan(desk.min.z);
    expect(AT.keyshelf[2]).toBeLessThan(desk.max.z);
    expect(AT.keyshelf[0]).toBeLessThan(bx + BOARD_WHOLE.w / 2 - 0.7);
    const st = w('stool');
    expect(st.x).toBeCloseTo(AT.stool.c[0], 2);
    expect(st.z).toBeCloseTo(AT.stool.c[2], 2);
    expect(S.stool.y).toBeCloseTo(BOARD_WHOLE.runner.top, 3);
    expect(fit.stool.seat[1]).toBeCloseTo(STOOL_SEAT, 2); // over the runner: loadBench stands it at S.stool.y
    expect(bz + pieceBounds(p).min.z).toBeCloseTo(-5 + 0.01, 2);
  });
});

describe("Fetch's reach (A1 round 6: arm's length, side-on or facing the visitor)", () => {
  const L = LINE.belt;
  const r = scene.runner.rounds!;
  const lap = scene.runner.attract!;
  const tray = scene.mouths!.find((m) => m.id === lap.tray)!;
  const feed = scene.mouths!.find((m) => m.id === r.mouth)!;
  const places: Array<['stack' | 'tray' | 'phone' | 'feed', number, number]> = [
    ['stack', r.stack[0], r.stack[1]],
    ['tray', tray.drop[0], tray.drop[2]],
    ['phone', lap.phone[0], lap.phone[2]],
    ['feed', feed.drop[0], feed.drop[2]],
  ];

  it('can run the lap with the telescoping arms\' reach (1.10): canRunLap', () => {
    expect(scene.runner.reach).toBeCloseTo(1.1, 6);
    expect(canRunLap(scene)).toEqual({ ok: true });
  });

  it.each(places)('stands within 1.0 of the %s, with it beside or in front (never behind its back)', (what, px, pz) => {
    const st = fetchStand(scene, what, px, pz);
    // (the stack: 1.05, the 0.05 its bottom crate needs to clear Fetch's round footprint on the jog, reported)
    expect(st.d, what).toBeLessThanOrEqual((what === 'stack' ? 1.05 : 1.0) + 1e-6);
    // the way it turns to it: no more than a quarter turn from facing the visitor (+Z)
    const dx = px - st.at[0], dz = pz - st.at[1];
    expect(dz, `${what}: behind the run`).toBeGreaterThanOrEqual(-0.05 * Math.hypot(dx, dz));
  });

  it("takes from the stack facing the visitor across clear bench (nothing taller than 1.8 between), and stands the tray's at the path's end, side-on", () => {
    const st = fetchStand(scene, 'stack', r.stack[0], r.stack[1]);
    const from = new Vector3(r.stack[0], 0.9, r.stack[1]), to = new Vector3(st.at[0], 0.9, st.at[1]);
    const ray = new Ray(from, to.clone().sub(from).normalize());
    for (const s of scene.statics) {
      if (s.id === 'bench' || s.id === 'back-wall') continue;
      const b = body(s.id);
      if (b.max.y <= 1.8) continue;
      const hit = ray.intersectBox(b, new Vector3());
      expect(hit && hit.distanceTo(from) < from.distanceTo(to) ? `${s.id} stands between the stack and Fetch` : null).toBe(null);
    }
    const t = fetchStand(scene, 'tray', tray.drop[0], tray.drop[2]);
    const end = AT.lane.points[AT.lane.points.length - 1]!;
    expect(Math.hypot(t.at[0] - end[0], t.at[1] - end[1])).toBeCloseTo(0, 3); // taken exactly: the path's very end
    // the reshaped platen's left stand: 0.40 outside its left foot (today's piece is placed with its left foot there)
    expect(body('platen-plinth').min.x - t.at[0]).toBeCloseTo(0.4, 2);
    expect(Math.abs(tray.drop[0] - t.at[0] - 0.99)).toBeLessThan(0.02); // PLATEN.stand.left: 0.99 from the seat
    expect(tray.drop[2]).toBeCloseTo(t.at[1], 3);
  });

  it("gets its grip to each thing it handles from where it stands, by the arm's own solver at the thing's real height (short 0)", () => {
    const S_HALF: V3 = [0.225, 0.225, 0.225];
    // the stack is two high (A1 round 7): its top crate as today's stack has it, and the tallest pair a restock can put
    // there (two L crates: the top one's middle 1.2 up, its own half 0.4)
    const top = scene.parts.find((p) => p.id === scene.button.stack[scene.button.stack.length - 1])!;
    expect(scene.button.stack.length).toBe(2);
    const seat = platen({ detail: 'low' } as never).sockets!['seat']!;
    const seatY = new Vector3().setFromMatrixPosition(seat).y;
    const grips: Array<['stack' | 'tray' | 'phone' | 'feed', V3, V3 | null]> = [
      ['stack', top.pose.p as unknown as V3, S_HALF],
      ['stack', [r.stack[0], CRATE_EDGE.L * 1.5, r.stack[1]], [0.4, 0.4, 0.4]],
      ['tray', [tray.drop[0], seatY + S_HALF[1], tray.drop[2]], S_HALF],
      ['phone', [lap.phone[0], lap.phone[1] + 0.14, lap.phone[2]], null], // the screen's middle
      ['feed', [feed.drop[0], feed.drop[1] + S_HALF[1], feed.drop[2]], S_HALF],
    ];
    for (const [what, p, half] of grips) {
      const st = fetchStand(scene, what, p[0], p[2]);
      const r = reachFrom([st.at[0], 0, st.at[1]], p, { half });
      if (process.env['BENCH_REPORT']) console.log(`GRIP ${what} short ${r.short.toFixed(3)} tele ${r.tele.toFixed(3)}`);
      expect(r.short, what).toBeLessThanOrEqual(0.005); // the solver's own tolerance
    }
  });

  it("feeds the belt in front of its front run, upstream of the striker and past the deflector's reach", () => {
    expect(feed.drop[0]).toBeGreaterThanOrEqual(L.from + 1.1 - 1e-6);
    expect(feed.drop[0]).toBeLessThan(LINE.strikerX - 0.5);
  });

  it("lands what the chute returns on clear bench, off the path's tape and left of the deflector's foot", () => {
    const p = chute({ detail: 'low', run: CHUTE_RUN, aim: CHUTE_AIM });
    const [cx, cz] = S.chute.at!;
    const mouth = new Vector3().setFromMatrixPosition(p.sockets!['mouth']!).add(new Vector3(cx, 0, cz));
    expect(mouth.distanceTo(new Vector3(...AT.chute.p))).toBeLessThan(0.01);
    const land = new Vector3().setFromMatrixPosition(p.sockets!['land']!).add(new Vector3(cx, 0, cz));
    expect(land.x + 0.25).toBeLessThan(L.offBack[0] - 0.4);
    const motor = body('belt-motor');
    expect(land.z + 0.25).toBeLessThan(motor.min.z);
    expect(AT.chute.linvel[0]).toBeGreaterThan(0);
    expect(AT.chute.linvel[1]).toBeGreaterThan(0);
  });

  it("keeps room for three crates side by side at the deflector's foot, clear of every body and of Fetch's path; the dock's ramp starts at the belt's open tail", () => {
    const p = belt({ length: LAYOUT.beltLength, detail: 'low', line: true });
    const [bx0, bz0] = S.belt.at!;
    const off = new Vector3().setFromMatrixPosition(p.sockets!['off.back']!).add(new Vector3(bx0, 0, bz0));
    const foot = new Box3(new Vector3(off.x - 0.4, 0, off.z - 0.4), new Vector3(off.x - 0.4 + 3 * 0.8, 0.8, off.z + 0.4));
    for (const s of scene.statics) {
      if (s.id === 'bench' || s.id === 'back-wall') continue;
      expect(foot.intersectsBox(body(s.id)) ? `the foot under ${s.id}` : null).toBe(null);
    }
    const pad = Math.hypot(defaultHalfExtents('robot', 'M')[0], defaultHalfExtents('robot', 'M')[2]) * CREW_SCALE;
    const path = lanePath(AT.lane.points as readonly (readonly [number, number])[], FETCH_TUNING.cornerRadius * CREW_SCALE);
    for (let i = 0; i <= 200; i++) {
      const [x, z] = path.at((path.length * i) / 200);
      const dx = Math.max(0, foot.min.x - x, x - foot.max.x), dz = Math.max(0, foot.min.z - z, z - foot.max.z);
      expect(Math.hypot(dx, dz)).toBeGreaterThan(pad);
    }
    const ramp = new Vector3().setFromMatrixPosition(p.sockets!['ramp']!).add(new Vector3(bx0, 0, bz0));
    expect(ramp.x).toBeCloseTo(L.to, 3);
    expect(S.dock.at![0] + DOCK_REACH[0] - 0.12).toBeCloseTo(ramp.x, 3);
  });

  it('keeps 1.4 round the path free of anything without a body Fetch could slide through when knocked (the chute stands off)', () => {
    const c = spotBox(S.chute);
    const path = lanePath(AT.lane.points as readonly (readonly [number, number])[], FETCH_TUNING.cornerRadius * CREW_SCALE);
    for (let i = 0; i <= 200; i++) {
      const [x, z] = path.at((path.length * i) / 200);
      const dx = Math.max(0, c.min.x - x, x - c.max.x), dz = Math.max(0, c.min.z - z, z - c.max.z);
      expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(1.4);
    }
  });
});

describe('the station files', () => {
  it('are found by name: each exports a station with a unique name, in an order the set and the crew rely on', async () => {
    const all = await benchStations();
    const names = all.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const want of ['set', 'parts', 'fetch', 'patch', 'board', 'belt', 'button']) expect(names, want).toContain(want);
    const at = (n: string): number => names.indexOf(n);
    // whatever feeds the set's pool comes before it; Fetch and Patch before the parts (W5: the crate in a hand or
    // a paw is handed to the parts view through its overlay, which runs while the parts view draws)
    for (const s of all) if (s.order < ORDER.set) expect(at(s.name), s.name).toBeLessThan(at('set'));
    expect(at('fetch')).toBeLessThan(at('parts'));
    expect(at('patch')).toBeLessThan(at('parts'));
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
