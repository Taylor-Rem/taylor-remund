// Carry-target mapping, the release-velocity estimate, and picking against proxies.
import { describe, expect, it } from 'vitest';
import { Box3, Group, PerspectiveCamera, Ray, Vector3 } from 'three';
import { CarryPlane, floorUnder, rayAtHeight, type Obstacle, type RayLike } from '../../../src/workshop/input/carry.ts';
import { VelocityTracker } from '../../../src/workshop/input/velocity.ts';
import { halfFootprint, halfHeight } from '../../../src/workshop/input/surface.ts';
import { Picking } from '../../../src/workshop/view/picking.ts';
import type { Vec3 } from '../../../src/workshop/sim/types.ts';

const bench = { minX: -10, maxX: 10, minZ: -5, maxZ: 5, top: 0, ceiling: 8 };
/** A ray from a camera up and in front, looking down at (x, 0, z) at about 33°. */
function rayAt(x: number, z: number, y = 0): RayLike {
  const origin: Vec3 = [x, y + 13, z + 20];
  const d = [0, -13, -20];
  const n = Math.hypot(d[0]!, d[1]!, d[2]!);
  return { origin, dir: [d[0]! / n, d[1]! / n, d[2]! / n] };
}
const box = (x: number, z: number, h: number, half = 0.4, bottom = 0): Obstacle => ({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half, top: h, bottom });

describe('carry target', () => {
  it('rides a plane its bottom `clearance` above the bench, on the pointer ray', () => {
    const plane = new CarryPlane(bench);
    const grip: Vec3 = [0, 0.5, 0];
    plane.begin({ kind: 'part', halfX: 0.3, halfZ: 0.3, gripAboveBottom: 0.5 }, grip, 0, []);
    const t = plane.target(rayAt(1, 1), 16, []);
    expect(t[1]).toBeCloseTo(0.85, 6); // 0 + 0.35 + 0.5
    // the target is on the ray
    const onRay = rayAtHeight(rayAt(1, 1), t[1]);
    expect(t[0]).toBeCloseTo(onRay[0], 6);
    expect(t[2]).toBeCloseTo(onRay[2], 6);
  });

  it('rises smoothly over tall things (eased, not a jump) and settles back down', () => {
    const plane = new CarryPlane(bench);
    plane.begin({ kind: 'part', halfX: 0.3, halfZ: 0.3, gripAboveBottom: 0.3 }, [0, 0.3, 0], 0, []);
    const stack = [box(3, 0, 1.8)];
    // pointing at the bench in front of the stack does not lift it (no feedback, no oscillation)
    const probe = new CarryPlane(bench);
    probe.begin({ kind: 'part', halfX: 0.3, halfZ: 0.3, gripAboveBottom: 0.3 }, [0, 0.3, 0], 0, []);
    for (let i = 0; i < 40; i++) expect(probe.target(rayAt(3, 2), i * 16, stack)[1]).toBeCloseTo(0.65, 6);
    const heights: number[] = [];
    let t = 0;
    // the pointer just above the stack on screen: the ray passes over it at the height the part would ride
    for (let i = 0; i < 40; i++) heights.push(plane.target(rayAt(3, 0, 2.45), (t += 16), stack)[1]);
    expect(heights[0]!).toBeLessThan(1.2); // not a jump on the first frame
    for (let i = 1; i < heights.length; i++) expect(heights[i]!).toBeGreaterThanOrEqual(heights[i - 1]! - 1e-9);
    expect(heights[heights.length - 1]!).toBeCloseTo(1.8 + 0.35 + 0.3, 2);
    // away from the stack it comes down again, more gently
    const down: number[] = [];
    for (let i = 0; i < 60; i++) down.push(plane.target(rayAt(-3, 0), (t += 16), stack)[1]);
    expect(down[0]!).toBeGreaterThan(2.0);
    expect(down[down.length - 1]!).toBeCloseTo(0.65, 2);
  });

  it('a part taken from the top of a stack stays clear of the crate it sat on until it has left its footprint', () => {
    const plane = new CarryPlane(bench);
    const under = [box(0, 0, 1.0, 0.3)];
    // the top crate (bottom at 1.0, grip 0.3 above its bottom) is lifted off the one below
    plane.begin({ kind: 'part', halfX: 0.25, halfZ: 0.25, gripAboveBottom: 0.3 }, [0, 1.3, 0], 0, under);
    expect(plane.height).toBeCloseTo(1.65, 6);
    // the pointer stays on the lifted grip (the ray through (0, 1.65, 0)): it must not sink into the crate below
    for (let i = 1; i <= 30; i++) expect(plane.target(rayAt(0, 0, 1.65), i * 16, under)[1]).toBeCloseTo(1.65, 6);
    // dragged well clear, it comes down to carry height over the bench
    let h = 0;
    for (let i = 31; i <= 120; i++) h = plane.target(rayAt(2.5, 0, 1.0), i * 16, under)[1];
    expect(h).toBeCloseTo(0.65, 2);
  });

  it('ignores what rests on top of the carried part (it is not under it)', () => {
    expect(floorUnder(0, 0, 0.3, 0.3, [box(0, 0, 2.0, 0.3, 1.2)], 0, 0.6)).toBe(0);
    expect(floorUnder(0, 0, 0.3, 0.3, [box(0, 0, 2.0, 0.3, 0)], 0, 0.6)).toBe(2.0);
  });

  it('stays over the bench and a little beyond its open edges, never into the back wall', () => {
    const plane = new CarryPlane(bench);
    plane.begin({ kind: 'part', halfX: 0.3, halfZ: 0.3, gripAboveBottom: 0.3 }, [0, 0.3, 0], 0, []);
    const far = plane.target(rayAt(40, 30), 16, []);
    expect(far[0]).toBeCloseTo(10 + plane.tuning.margin, 6);
    expect(far[2]).toBeCloseTo(5 + plane.tuning.margin, 6);
    const back = plane.target(rayAt(0, -30), 32, []);
    expect(back[2]).toBeCloseTo(-5 + 0.3, 6);
  });

  it('the plug rides a vertical plane in front of the jacks', () => {
    const plane = new CarryPlane(bench);
    plane.begin({ kind: 'plug', jackZ: -4 }, [0, 1.15, -4], 0, []);
    const t = plane.target(rayAt(1, -4), 16, []);
    expect(t[2]).toBeCloseTo(-4 + plane.tuning.plugStandoff, 6);
    expect(t[1]).toBeGreaterThan(0);
  });

  it('spot: where a part set down at the pointer lands is the top of what is there', () => {
    const plane = new CarryPlane(bench);
    expect(plane.spot(rayAt(2, 1), 0.2, 0.2, [])[1]).toBe(0);
    expect(plane.spot(rayAt(3, 0), 0.2, 0.2, [box(3, 0, 0.8)])[1]).toBeCloseTo(0.8, 6);
  });

  it('rotated boxes: half height and footprint', () => {
    const q: [number, number, number, number] = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)]; // 90° about Z
    expect(halfHeight(q, [0.5, 0.1, 0.2])).toBeCloseTo(0.5, 6);
    const [hx, hz] = halfFootprint(q, [0.5, 0.1, 0.2]);
    expect(hx).toBeCloseTo(0.1, 6);
    expect(hz).toBeCloseTo(0.2, 6);
  });
});

describe('release velocity', () => {
  it('averages the last 80 ms, robust to uneven event spacing', () => {
    const v = new VelocityTracker();
    // 5 units/s along x, events at irregular times
    let t = 0;
    for (const dt of [16, 3, 25, 8, 16, 1, 30, 16, 9]) {
      t += dt;
      v.add(t, [t * 0.005, 0, 0]);
    }
    const est = v.velocity(t);
    expect(est[0]).toBeCloseTo(5, 6);
  });

  it('a jittery last event does not decide the throw', () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 10; i++) v.add(i * 16, [i * 0.08, 0, 0]); // 5 u/s
    v.add(161, [0.8 + 0.05, 0, 0]); // a 1 ms jump of 0.05: 50 u/s if taken alone
    const est = v.velocity(161);
    expect(est[0]).toBeGreaterThan(4);
    expect(est[0]).toBeLessThan(6.5);
  });

  it('decays to nothing when the hand has stopped', () => {
    const v = new VelocityTracker();
    for (let i = 0; i <= 10; i++) v.add(i * 16, [i * 0.08, 0, 0]);
    expect(v.velocity(160 + 40)[0]).toBeCloseTo(2.5, 6);
    expect(v.velocity(160 + 90)).toEqual([0, 0, 0]);
  });
});

describe('picking against proxies', () => {
  const make = () => {
    const picking = new Picking();
    const a = new Group();
    a.position.set(0, 0.3, 0);
    a.updateMatrixWorld(true);
    picking.add('a', a, { box: new Box3(new Vector3(-0.3, -0.3, -0.3), new Vector3(0.3, 0.3, 0.3)), pad: 0 });
    const b = new Group();
    b.position.set(2, 0.1, 0);
    b.updateMatrixWorld(true);
    picking.add('b', b, { box: new Box3(new Vector3(-0.05, -0.05, -0.05), new Vector3(0.05, 0.05, 0.05)), pad: 0 });
    const cam = new PerspectiveCamera(20, 1.6, 0.5, 100);
    cam.position.set(0, 13, 20);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    picking.setView(cam, 900);
    return { picking, cam };
  };
  const ray = (from: Vector3, to: Vector3) => new Ray(from.clone(), to.clone().sub(from).normalize());

  it('nearest true hit, with point and face normal', () => {
    const { picking } = make();
    const hit = picking.pick(ray(new Vector3(0, 5, 0), new Vector3(0, 0, 0)));
    expect(hit?.id).toBe('a');
    expect(hit?.point.y).toBeCloseTo(0.6, 6);
    expect(hit?.normal.y).toBeCloseTo(1, 6);
    expect(hit?.grown).toBe(false);
  });

  it('a near miss of something small hits only with a minimum on-screen size (44 px on touch)', () => {
    const { picking, cam } = make();
    const r = ray(cam.position, new Vector3(2.12, 0.1, 0));
    expect(picking.pick(r)).toBeNull();
    const hit = picking.pick(r, { minPx: 44 });
    expect(hit?.id).toBe('b');
    expect(hit?.grown).toBe(true);
  });

  it('exclude, filter and hidden objects', () => {
    const { picking } = make();
    const r = ray(new Vector3(0, 5, 0), new Vector3(0, 0, 0));
    expect(picking.pick(r, { exclude: 'a' })).toBeNull();
    expect(picking.pick(r, { filter: (id) => id !== 'a' })).toBeNull();
    expect(picking.has('a')).toBe(true);
  });

  it('follows its object: the proxy rides the world matrix', () => {
    const picking = new Picking();
    const g = new Group();
    picking.add('m', g, { box: new Box3(new Vector3(-0.2, -0.2, -0.2), new Vector3(0.2, 0.2, 0.2)) });
    g.position.set(5, 0, 0);
    g.updateMatrixWorld(true);
    expect(picking.pick(ray(new Vector3(0, 5, 0), new Vector3(0, 0, 0)))).toBeNull();
    expect(picking.pick(ray(new Vector3(5, 5, 0), new Vector3(5, 0, 0)))?.id).toBe('m');
  });
});
