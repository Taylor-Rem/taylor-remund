import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, fitDistance, viewDirection } from '../../../src/workshop/view/stage/camera.ts';

const corners = (b: Box3): Vector3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));

function insideFrame(rig: CameraRig, b: Box3, slack = 1e-6): boolean {
  return corners(b).every((c) => {
    const p = rig.worldToScreen(c);
    return Math.abs(p.x) <= 1 + slack && Math.abs(p.y) <= 1 + slack && p.z > -1 && p.z < 1;
  });
}

const bench = new Box3(new Vector3(-10, 0, -5), new Vector3(10, 4, 5));
const cluster = new Box3(new Vector3(-2.4, 0, -0.6), new Vector3(3.8, 1.6, 2.6));

describe('camera rig: a long lens at a fixed pitch', () => {
  it('looks down at the configured pitch through a long lens', () => {
    const rig = new CameraRig({ fov: 20, pitch: 33 });
    expect(rig.camera.fov).toBe(20);
    const d = viewDirection(33);
    expect(Math.asin(-d.y) * (180 / Math.PI)).toBeCloseTo(33, 6);
    const look = new Vector3();
    rig.camera.getWorldDirection(look);
    expect(look.angleTo(d)).toBeLessThan(1e-6);
  });

  for (const [w, h] of [
    [1440, 900],
    [390, 844],
    [2560, 1080],
  ] as const) {
    it(`frame(box) puts every corner of the box inside the frame at ${w}×${h}`, () => {
      const rig = new CameraRig();
      rig.setAspect(w / h);
      for (const b of [bench, cluster, new Box3(new Vector3(0, 0, 1), new Vector3(1.2, 1.4, 2))]) {
        rig.setSubject(bench);
        rig.cutTo(rig.frame(b));
        // zoom is clamped to 0..1, so a box bigger than the subject may not fit: only check boxes inside the zoom range
        const z = rig.frame(b).zoom;
        if (z >= 0 && z <= 1) expect(insideFrame(rig, b)).toBe(true);
      }
    });
  }

  it('the fit is tight: at least one corner touches the margin', () => {
    const rig = new CameraRig({ margin: 0.06 });
    rig.setAspect(1440 / 900);
    rig.setSubject(bench);
    rig.cutTo(rig.home());
    const max = Math.max(...corners(bench).map((c) => {
      const p = rig.worldToScreen(c);
      return Math.max(Math.abs(p.x), Math.abs(p.y));
    }));
    expect(max).toBeGreaterThan(0.85);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('a portrait phone fits by its narrow side (width), so the subject is farther away', () => {
    const wide = fitDistance(cluster, cluster.getCenter(new Vector3()), 20, 1440 / 900, 33);
    const tall = fitDistance(cluster, cluster.getCenter(new Vector3()), 20, 390 / 844, 33);
    expect(tall).toBeGreaterThan(wide * 2);
  });

  it('on a phone, the front-edge option slides the spare height onto the bench', () => {
    const rig = new CameraRig();
    rig.setAspect(390 / 844);
    rig.setSubject(cluster, { edge: { y: 0, z: 5.2 }, bounds: bench });
    rig.cutTo(rig.home());
    expect(insideFrame(rig, cluster)).toBe(true);
    const edge = rig.worldToScreen({ x: 0.7, y: 0, z: 5.2 });
    expect(edge.y).toBeLessThan(-0.85); // the bench front sits at the bottom of the frame
  });

  it('zoomBy toward a pointer keeps the bench point under it', () => {
    const rig = new CameraRig();
    rig.setAspect(1440 / 900);
    rig.setSubject(bench);
    rig.cutTo({ focus: [0, 0, 0], zoom: 0.4 });
    const ndc = { x: 0.3, y: -0.2 };
    const before = rig.benchPoint(ndc)!;
    rig.zoomBy(0.7, ndc);
    const after = rig.benchPoint(ndc)!;
    expect(after.distanceTo(before)).toBeLessThan(1e-3);
    expect(rig.zoom).toBeGreaterThan(0.4);
  });

  it('zoom 0 is the whole subject and 1 is one station; distance falls monotonically', () => {
    const rig = new CameraRig();
    rig.setAspect(1440 / 900);
    rig.setSubject(bench);
    let last = Infinity;
    for (let z = 0; z <= 1.0001; z += 0.1) {
      rig.cutTo({ focus: [0, 0, 0], zoom: z });
      expect(rig.distance).toBeLessThan(last);
      last = rig.distance;
    }
  });

  it('screenToRay and worldToScreen agree', () => {
    const rig = new CameraRig();
    rig.setAspect(1440 / 900);
    const p = new Vector3(1.5, 0.4, 0.7);
    const s = rig.worldToScreen(p);
    const ray = rig.screenToRay(s);
    expect(ray.distanceToPoint(p)).toBeLessThan(1e-4);
  });

  it('easeTo is a cut under reduced motion', () => {
    const rig = new CameraRig({ reducedMotion: true });
    rig.setAspect(1.6);
    rig.easeTo({ focus: [2, 0, 1], zoom: 0.8 });
    expect(rig.easing).toBe(false);
    expect(rig.zoom).toBeCloseTo(0.8, 6);
  });

  it('easeTo arrives after its duration', () => {
    const rig = new CameraRig();
    rig.setAspect(1.6);
    rig.setSubject(bench);
    rig.easeTo({ focus: [2, 0, 1], zoom: 0.8 }, 0.5);
    for (let i = 0; i < 40; i++) rig.update(1 / 60);
    expect(rig.easing).toBe(false);
    expect(rig.zoom).toBeCloseTo(0.8, 6);
    expect(rig.focus.x).toBeCloseTo(2, 6);
  });
});
