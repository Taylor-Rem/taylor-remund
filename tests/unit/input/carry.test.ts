// Carry-target mapping, and picking against proxies. (The throw is the world's: tests/scenario/hand-continuity.test.ts.)
import { describe, expect, it } from 'vitest';
import { Box3, Group, PerspectiveCamera, Ray, Vector3 } from 'three';
import { CarryPlane, floorUnder, rayAtHeight, type Obstacle, type RayLike } from '../../../src/workshop/input/carry.ts';
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

  // (rayAt(x, z) aims at the bench point (x, 0, z): at the carrying height 0.65 the hold is one unit nearer the visitor)
  const shape = { kind: 'part' as const, halfX: 0.3, halfZ: 0.3, gripAboveBottom: 0.3 };

  it('climbs over what it would run into (eased, not a jump), stays under the pointer, and comes down again past it', () => {
    const stack = [box(3, 0, 1.8)];
    // pointing at the bench in front of the stack does not lift it (no feedback, no oscillation)
    const probe = new CarryPlane(bench);
    probe.begin(shape, [0, 0.3, 0], 0, []);
    for (let i = 0; i < 40; i++) expect(probe.target(rayAt(3, 2), i * 16, stack)[1]).toBeCloseTo(0.65, 6);
    // a hand going up the screen from in front of the stack: the hold runs back into it, and rises
    const plane = new CarryPlane(bench);
    plane.begin(shape, [3, 0.3, 4], 0, []);
    let t = 0;
    let prev = plane.target(rayAt(3, 3), (t += 16), stack);
    let last = prev;
    for (let z = 3; z >= -3.4; z -= 0.05) {
      const ray = rayAt(3, z);
      const p = plane.target(ray, (t += 16), stack);
      expect(p[1]).toBeGreaterThanOrEqual(prev[1] - 1e-9); // only ever up on the way in
      expect(p[1] - prev[1]).toBeLessThan(0.5); // eased: no jump in height from one frame to the next
      // on the pointer's ray the whole way: under the pointer on the screen
      const k = (p[1] - ray.origin[1]) / ray.dir[1];
      expect(p[2]).toBeCloseTo(ray.origin[2] + ray.dir[2] * k, 6);
      prev = p;
      last = p;
    }
    for (let i = 0; i < 30; i++) last = plane.target(rayAt(3, -3.4), (t += 16), stack);
    expect(last[1]).toBeCloseTo(1.8 + 0.35 + 0.3, 2); // over the stack, clear of its top
    expect(Math.abs(last[2])).toBeLessThan(0.74);
    // away from the stack it comes down again, more gently
    const down: number[] = [];
    for (let i = 0; i < 60; i++) down.push(plane.target(rayAt(-3, 0), (t += 16), stack)[1]);
    expect(down[0]!).toBeGreaterThan(2.0);
    expect(down[down.length - 1]!).toBeCloseTo(0.65, 2);
  });

  it('carried along the bench BEHIND a tall thing, it stays on the bench behind it: no hop onto what the pointer passes above', () => {
    const stack = [box(3, 0, 1.8)];
    const plane = new CarryPlane(bench);
    plane.begin(shape, [0, 0.3, -2.2], 0, []);
    let t = 0;
    // aimed so that the hold runs along z = -2.2: at x = 3 the ray passes right over the stack at the height it would ride
    for (let x = 0; x <= 6; x += 0.05) {
      const p = plane.target(rayAt(x, -3.2), (t += 16), stack);
      expect(p[1]).toBeCloseTo(0.65, 6);
      expect(p[2]).toBeCloseTo(-2.2, 6);
    }
  });

  it('pushed into a low, wide thing from behind (the belt, a tray), it goes up onto it', () => {
    const tray = [box(3, 0, 0.5, 0.6)];
    const plane = new CarryPlane(bench);
    plane.begin(shape, [3, 0.3, -3], 0, []);
    let t = 0;
    let p: Vec3 = [0, 0, 0];
    for (let z = -4; z <= -1.8; z += 0.05) p = plane.target(rayAt(3, z), (t += 16), tray);
    for (let i = 0; i < 30; i++) p = plane.target(rayAt(3, -1.8), (t += 16), tray);
    expect(p[1]).toBeCloseTo(0.5 + 0.35 + 0.3, 2);
    expect(Math.abs(p[2])).toBeLessThan(0.6);
  });

  // (the browser's juggling tests, 2026-11-20: a thing caught low went on a level and walked back with the next flick
  // (Fetch caught at 1.47: z -2.48 to -3.03 in the hand); one caught behind the back line snapped forward to it (Patch
  // from z -3.99 to -1.78); and Fetch caught near the wall was sent to the ceiling and off the front: the wall's top,
  // 9 up, had been taken for a level to carry it over)
  it('caught in flight low, or near the back wall: held exactly where it was caught, and up and down from there', () => {
    const wall: Obstacle[] = [{ minX: -10.5, maxX: 10.5, minZ: -5.3, maxZ: -5, top: 9, bottom: 0 }];
    for (const grip of [[1, 1.2, 0.5], [1, 0.9, 2], [-5, 3, -4.3], [-5, 2.5, -4.49]] as Vec3[]) {
      const plane = new CarryPlane(bench);
      // (a tumbling robot's footprint: wide enough to reach the wall from where it was caught)
      plane.begin({ kind: 'part', halfX: 0.9, halfZ: 0.9, gripAboveBottom: 0.3 }, grip, 0, wall, true);
      const through = (y: number): RayLike => rayAt(grip[0], grip[2], y);
      let t = 0;
      for (let i = 0; i < 30; i++) {
        const p = plane.target(through(grip[1]), (t += 16), wall);
        expect(p[0]).toBeCloseTo(grip[0], 6);
        expect(p[1]).toBeCloseTo(grip[1], 6);
        expect(p[2]).toBeCloseTo(grip[2], 6);
      }
      const up = plane.target(through(grip[1] + 1), (t += 16), wall);
      expect(up[1]).toBeCloseTo(grip[1] + 1, 6);
      expect(up[2]).toBeCloseTo(grip[2], 6);
    }
  });

  it('nothing under the bench is a level to carry over: a part stowed below it, the bench\'s own body', () => {
    // (found on the page 2026-11-20: spare crates stowed four units under the bench were taken for levels, and a
    // carried crate sank to the bench top when its own level stopped making sense near the back)
    const under: Obstacle[] = [box(0, 0, -3.6, 0.3, -4.4), { minX: -10, maxX: 10, minZ: -5, maxZ: 5, top: 0, bottom: -1 }, box(3, 0, 1.8)];
    const plane = new CarryPlane(bench);
    plane.begin(shape, [3, 0.3, 4], 0, []);
    let t = 0;
    // into the stack from the front (its level stops making sense), across the fillet at the back, and round
    for (let z = 3; z >= -5; z -= 0.05) expect(plane.target(rayAt(3, z), (t += 16), under)[1]).toBeGreaterThanOrEqual(0.65 - 1e-6);
    for (let x = 3; x >= -6; x -= 0.05) expect(plane.target(rayAt(x, -5), (t += 16), under)[1]).toBeGreaterThanOrEqual(0.65 - 1e-6);
  });

  it('taken in the air it is held where it was taken: up and down with the pointer at that depth, and back onto the level when brought down', () => {
    const plane = new CarryPlane(bench);
    // caught 3 up over the middle of the bench, flying
    const grip: Vec3 = [1, 3, 0.5];
    plane.begin(shape, grip, 0, [], true);
    const through = (y: number): RayLike => rayAt(1, 0.5, y);
    let t = 0;
    const p0 = plane.target(through(3), (t += 16), []);
    expect(p0[0]).toBeCloseTo(1, 6);
    expect(p0[1]).toBeCloseTo(3, 6);
    expect(p0[2]).toBeCloseTo(0.5, 6);
    // held still, it stays (it does not sink away along the ray)
    for (let i = 0; i < 30; i++) expect(plane.target(through(3), (t += 16), [])[1]).toBeCloseTo(3, 6);
    // the pointer up: straight up at that depth
    const up = plane.target(through(4.5), (t += 16), []);
    expect(up[1]).toBeCloseTo(4.5, 6);
    expect(up[2]).toBeCloseTo(0.5, 6);
    // brought down with no jump, round the curve and out onto the level in front
    let prev = up;
    for (let y = 4.5; y >= -1; y -= 0.05) {
      const p = plane.target(through(y), (t += 16), []);
      expect(Math.hypot(p[1] - prev[1], p[2] - prev[2])).toBeLessThan(0.2);
      prev = p;
    }
    expect(prev[1]).toBeCloseTo(0.65, 2);
    expect(prev[2]).toBeGreaterThan(0.5);
    // on the level, the upright face is in front of the wall again: the pointer up the screen carries it back
    const back = plane.target(rayAt(1, -2), (t += 16), []);
    expect(back[1]).toBeCloseTo(0.65, 2);
    expect(back[2]).toBeCloseTo(-1, 2);
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
    // pointed far back, it is lifted up the upright face in front of the wall, never into it
    const back = plane.target(rayAt(0, -30), 32, []);
    expect(back[2]).toBeCloseTo(plane.tuning.backLine + 0.3 + plane.tuning.footprintPad, 6);
    expect(back[1]).toBeGreaterThan(1);
  });

  describe('the surface curves up at the back (Taylor, 2026-11-20: lift up rather than push back)', () => {
    /** A camera like the home view's: up and in front, the pointer swept up the screen (the ray tilting up). */
    const sweep = (k: number): RayLike => {
      const origin: Vec3 = [0.5, 9, 14];
      const a = -0.75 + k; // the ray's pitch, radians below the horizontal
      const d = [0.02, -Math.sin(-a), -Math.cos(-a)];
      const n = Math.hypot(d[0]!, d[1]!, d[2]!);
      return { origin, dir: [d[0]! / n, d[1]! / n, d[2]! / n] };
    };
    const begin = () => {
      const plane = new CarryPlane(bench);
      plane.begin({ kind: 'part', halfX: 0.25, halfZ: 0.25, gripAboveBottom: 0.25 }, [0, 0.25, 0], 0, []);
      return plane;
    };

    it('raising the pointer past the back of the bench lifts the thing: up to the top, never behind the upright face', () => {
      const plane = begin();
      const T = plane.tuning;
      const zv = T.backLine + 0.25 + T.footprintPad;
      let topY = 0;
      for (let i = 0; i <= 400; i++) {
        const p = plane.target(sweep(i * 0.002), 16 * i, []);
        expect(p[2]).toBeGreaterThanOrEqual(zv - 1e-9);
        topY = Math.max(topY, p[1]);
      }
      expect(topY).toBeCloseTo(T.top, 6);
    });

    it('on the pointer ray the whole way (under the pointer on screen), until the top', () => {
      const plane = begin();
      for (let i = 0; i <= 300; i++) {
        const r = sweep(i * 0.002);
        const p = plane.target(r, 16 * i, []);
        if (p[1] >= plane.tuning.top - 1e-9) break;
        // the point minus the origin is parallel to the ray
        const v = [p[0] - r.origin[0], p[1] - r.origin[1], p[2] - r.origin[2]];
        const n = Math.hypot(v[0]!, v[1]!, v[2]!);
        expect(Math.abs((v[0]! * r.dir[0] + v[1]! * r.dir[1] + v[2]! * r.dir[2]) / n - 1)).toBeLessThan(1e-9);
      }
    });

    it('no jump in place or in speed under a steady hand (level, fillet and upright face meet with the same slope)', () => {
      const plane = begin();
      const at = (k: number) => plane.hit(sweep(k), plane.height);
      // the pieces it passes through
      const thetas = [0.1, 0.3, 0.45].map((k) => at(k).theta);
      expect(Math.min(...thetas)).toBe(0);
      expect(Math.max(...thetas)).toBeCloseTo(Math.PI / 2, 6);
      // each join, found by bisection: where the slope leaves 0, and where it reaches π/2
      const join = (pass: (k: number) => boolean): number => {
        let lo = 0;
        let hi = 0.6;
        for (let n = 0; n < 60; n++) {
          const m = (lo + hi) / 2;
          if (pass(m)) hi = m;
          else lo = m;
        }
        return hi;
      };
      const speed = (k: number, e = 1e-7): number => {
        const a = at(k).p;
        const b = at(k + e).p;
        return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / e;
      };
      for (const k of [join((m) => at(m).theta > 0), join((m) => at(m).theta >= Math.PI / 2 - 1e-12)]) {
        const before = at(k - 1e-5).p;
        const after = at(k + 1e-5).p;
        // no jump in place: a 2e-5 turn of the hand moves it a hair
        expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeLessThan(speed(k - 1e-5) * 2e-5 * 1.05 + 1e-9);
        // nor in speed: just before and just after the join, within 1%
        expect(Math.abs(speed(k + 1e-5) / speed(k - 1e-5) - 1)).toBeLessThan(0.01);
      }
    });

    it('unrolled, the surface runs on: s is z over the bench and keeps falling round the curve and up the face', () => {
      const plane = begin();
      let last = Infinity;
      for (let i = 0; i <= 400; i++) {
        const h = plane.hit(sweep(i * 0.002), plane.height);
        if (h.p[1] >= plane.tuning.top - 1e-9) break;
        if (h.theta === 0) expect(h.s).toBeCloseTo(h.p[2], 9);
        expect(h.s).toBeLessThan(last + 1e-9);
        last = h.s;
      }
    });

    it('over something tall under the upright face (the storefront), the whole profile rides over it', () => {
      const plane = begin();
      const store: Obstacle = { minX: -1, maxX: 1, minZ: -4.07, maxZ: -3.0, top: 2.83, bottom: 0 };
      let p: Vec3 = [0, 0, 0];
      // pointed over its front at the height the part would ride over it
      for (let i = 0; i < 120; i++) p = plane.target(sweep(0.44), 16 * i, [store]);
      expect(plane.height).toBeGreaterThan(2.83);
      expect(p[1] - 0.25).toBeGreaterThan(2.83);
    });
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

  it('a proxy under a scaled node grows to the minimum size in WORLD units, not 10× it (I1 round 3)', () => {
    const { picking, cam } = make();
    // the Button's cap: a 0.1 box under a node scaled 10× (1 unit across in the world)
    const c = new Group();
    c.position.set(-3, 0.5, 0);
    c.scale.set(10, 5, 10);
    c.updateMatrixWorld(true);
    picking.add('cap', c, { box: new Box3(new Vector3(-0.05, -0.05, -0.05), new Vector3(0.05, 0.05, 0.05)), pad: 0.03 });
    const at = (x: number) => ray(cam.position, new Vector3(x, 0.5, 0));
    expect(picking.pick(at(-3), { minPx: 44 })?.id).toBe('cap');
    // its edge is at x = -2.5; with the pad 3 cm more. 0.6 units beyond is far outside a 44 px target at this distance
    expect(picking.unitsPerPixel(new Vector3(-3, 0.5, 0)) * 22).toBeLessThan(0.3);
    expect(picking.pick(at(-1.9), { minPx: 44 })?.id).not.toBe('cap');
  });

  it('a target scaled away (hidden the house way) is not there', () => {
    const { picking } = make();
    const h = new Group();
    h.position.set(-4, 0.5, 0);
    h.scale.setScalar(1e-4);
    h.updateMatrixWorld(true);
    picking.add('cover', h, { box: new Box3(new Vector3(-0.05, -0.05, -0.05), new Vector3(0.05, 0.05, 0.05)) });
    expect(picking.pick(ray(new Vector3(-4, 5, 0), new Vector3(-4, 0, 0)), { minPx: 44 })?.id).not.toBe('cover');
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
