/**
 * The vignette's composition (REWRITE.md § B3 "The centre cluster", § C
 * "Nothing usable is hidden behind anything else", § G P1), checked as
 * geometry: the simulation's scene with the real pieces stood on it, the
 * camera's two homes through the real camera rig, and the cord's rope.
 */
import { Box3, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../../src/workshop/view/stage/camera.ts';
import { FRAMING, LAYOUT, fitPieces, homeBox, measured, staticBox } from '../../../src/workshop/view/vignette.ts';
import { Rope, CORD_FEEL } from '../../../src/workshop/view/stations/cord.ts';
import { vignette as scene } from '../../../src/workshop/sim/index.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';
import { switchboard, stool } from '../../../src/workshop/view/kit/pieces/switchboard/index.ts';
import { belt } from '../../../src/workshop/view/kit/pieces/belt/index.ts';
import { CONSOLE, BUTTON } from '../../../src/workshop/view/kit/pieces/button/index.ts';

// the real pieces (sizes and sockets; no labels needed)
const fit = fitPieces(scene, { board: switchboard({ detail: 'low' }), stool: stool({ detail: 'low' }), belt: belt({ length: LAYOUT.beltLength, detail: 'low' }) });
const body = (id: string): Box3 => {
  const b = staticBox(scene, id);
  if (!b) throw new Error(`no static ${id}`);
  return b;
};

/** Where the fumbled crate comes to rest (the simulation's tuning: about (1.71, 2.34)). */
const REST: Vec3 = [1.71, 0.225, 2.34];

/** The four things a phone must show (§ B3): the Button, the loose crate where it comes to rest, the phone, Patch. */
function cluster(): Record<string, Box3> {
  const seat = fit.stool.seat;
  return {
    button: body('console').expandByVector(new Vector3(0, 0.45, 0)),
    crate: new Box3(new Vector3(REST[0] - 0.25, 0, REST[2] - 0.25), new Vector3(REST[0] + 0.25, 0.45, REST[2] + 0.25)),
    phone: body('phone'),
    patch: new Box3(new Vector3(seat[0] - 0.35, seat[1], seat[2] - 0.3), new Vector3(seat[0] + 0.35, seat[1] + 1.1, seat[2] + 0.3)),
  };
}

function rigAt(w: number, h: number): CameraRig {
  const rig = new CameraRig({ fov: 20, pitch: 33 });
  rig.setAspect(w / h);
  rig.setSubject(homeBox(w < h), { edge: { y: 0, z: scene.bench.maxZ }, bounds: new Box3(new Vector3(-10, -1, -5), new Vector3(10, 5, 5)) });
  rig.cutTo(rig.home());
  return rig;
}

const inFrame = (rig: CameraRig, b: Box3): boolean =>
  [0, 1, 2, 3, 4, 5, 6, 7].every((i) => {
    const p = rig.worldToScreen(new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
    return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
  });

describe('the vignette on the simulation scene', () => {
  it('keeps the centre cluster inside the middle 40% of the bench', () => {
    const span = (scene.bench.maxX - scene.bench.minX) * 0.4;
    for (const [name, b] of Object.entries(cluster())) {
      expect(b.min.x, name).toBeGreaterThanOrEqual(-span / 2);
      expect(b.max.x, name).toBeLessThanOrEqual(span / 2);
    }
  });

  it('stands the board against the wall on its body, and its jacks on the board', () => {
    const b = body('board');
    expect(fit.board.at.x).toBeCloseTo(b.getCenter(new Vector3()).x, 6);
    for (const j of Object.values(fit.board.jacks)) {
      expect(j[0]).toBeGreaterThan(b.min.x);
      expect(j[0]).toBeLessThan(b.max.x);
      expect(j[1]).toBeGreaterThan(1);
    }
  });

  it('seats Patch on the stool beside the board, clear of both jack tapes', () => {
    const b = body('board');
    expect(fit.stool.seat[1]).toBeGreaterThan(0.5);
    // the designs face -X, side-on: the board on their front-left, so the stool stands past the board's right end
    expect(fit.stool.seat[0] - 0.3).toBeGreaterThan(b.max.x);
  });

  it('reports the pieces against the simulation', () => {
    const m = measured(scene, fit, { console: CONSOLE, deckY: BUTTON.deckY });
    for (const k of ['board', 'stool', 'jacks', 'cordRoot', 'seat', 'console']) expect(m[k], k).toBeTruthy();
  });
});

describe('the camera homes', () => {
  it('shows the Button, the loose crate, the phone and Patch on an upright phone (390×844) without panning', () => {
    const rig = rigAt(390, 844);
    for (const [name, b] of Object.entries(cluster())) expect(inFrame(rig, b), name).toBe(true);
  });

  it('shows the centre cluster with the wall behind at 1440×900', () => {
    const rig = rigAt(1440, 900);
    for (const [name, b] of Object.entries(cluster())) expect(inFrame(rig, b), name).toBe(true);
    expect(inFrame(rig, new Box3(new Vector3(LAYOUT.sign.x - 2.4, LAYOUT.sign.y, -5), new Vector3(LAYOUT.sign.x + 2.4, LAYOUT.sign.y + 1.2, -4.8)))).toBe(true);
    expect(inFrame(rig, body('board'))).toBe(true);
  });

  it('hides nothing usable behind anything else from the fixed camera', () => {
    const rig = rigAt(1440, 900);
    const eye = rig.camera.position.clone();
    const targets: Record<string, Vec3> = {
      'button cap': scene.button.at,
      ...Object.fromEntries(Object.entries(fit.board.jacks).map(([k, v]) => [`jack ${k}`, v])),
      phone: [body('phone').getCenter(new Vector3()).x, 0.55, body('phone').getCenter(new Vector3()).z],
      'patch head': [fit.stool.seat[0], fit.stool.seat[1] + 0.9, fit.stool.seat[2]],
      'stack top': scene.parts.find((p) => p.id === scene.button.stack[2])!.pose.p,
      'fetch offering': [2.5, 0.8, scene.runner.lane.a[1]],
      'loose crate': REST,
    };
    const blockers = scene.statics.filter((s) => s.id !== 'bench' && s.id !== 'back-wall').map((s) => [s.id, body(s.id)] as const);
    for (const [name, t] of Object.entries(targets)) {
      const to = new Vector3(...t);
      const ray = new Ray(eye, to.clone().sub(eye).normalize());
      const dist = eye.distanceTo(to);
      for (const [id, b] of blockers) {
        if (b.clone().expandByScalar(0.05).containsPoint(to)) continue; // its own body
        const hit = ray.intersectBox(b, new Vector3());
        expect(hit && eye.distanceTo(hit) < dist - 0.05 ? `${name} hidden by ${id}` : null).toBe(null);
      }
    }
  });

  it('frames the wide home from the framing table', () => {
    expect(homeBox(false).min.toArray()).toEqual([...FRAMING.wide.min]);
  });
});

describe('the cord rope', () => {
  const a = new Vector3(0, 0.9, 0.3), b = new Vector3(1.2, 1.6, 0);
  const up = new Vector3(0, 1, 0), back = new Vector3(0, 0, 1);
  const floor = (v: Vector3): void => {
    if (v.y < CORD_FEEL.radius) v.y = CORD_FEEL.radius;
  };

  it('keeps its length, hangs below its ends and settles', () => {
    const L = a.distanceTo(b) + 0.75;
    const r = new Rope(a, b, CORD_FEEL.points, L);
    for (let i = 0; i < 600; i++) r.step(1 / 60, a, up, b, back, floor);
    let len = 0;
    for (let i = 1; i < r.p.length; i++) len += r.p[i]!.distanceTo(r.p[i - 1]!);
    expect(len).toBeGreaterThan(L * 0.97);
    expect(len).toBeLessThan(L * 1.03);
    expect(Math.min(...r.p.map((p) => p.y))).toBeLessThan(Math.min(a.y, b.y));
    const before = r.p.map((p) => p.clone());
    r.step(1 / 60, a, up, b, back, floor);
    expect(Math.max(...r.p.map((p, i) => p.distanceTo(before[i]!)))).toBeLessThan(2e-3);
  });

  it('does not move at all on a frame with no time', () => {
    const r = new Rope(a, b, CORD_FEEL.points, a.distanceTo(b) + 0.75);
    r.step(1 / 60, a, up, b, back, floor);
    const before = r.p.map((p) => p.clone());
    r.step(0, a, up, b, back, floor);
    expect(r.p.every((p, i) => p.equals(before[i]!))).toBe(true);
  });

  it('stays above the bench', () => {
    const lo = new Vector3(2, 0.2, 0);
    const r = new Rope(a, lo, CORD_FEEL.points, 4);
    for (let i = 0; i < 300; i++) r.step(1 / 60, a, up, lo, back, floor);
    expect(Math.min(...r.p.map((p) => p.y))).toBeGreaterThanOrEqual(CORD_FEEL.radius - 1e-3);
  });
});
