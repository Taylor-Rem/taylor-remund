// P4 S5 round three: a thing on an open crate's tray wins every press whose ray passes through it, over the crate (and
// its lid and latch) whose box is nearer along the ray (view/picking.ts `prefer`).
import { Box3, Object3D, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Picking } from '../../../src/workshop/view/picking.ts';

const at = (x: number, y: number, z: number): Object3D => {
  const o = new Object3D();
  o.position.set(x, y, z);
  o.updateMatrixWorld(true);
  return o;
};
const box = (h: number[]): Box3 => new Box3(new Vector3(-h[0]!, -h[1]!, -h[2]!), new Vector3(h[0]!, h[1]!, h[2]!));

describe('picking: a target that wins over others wherever the ray passes through it', () => {
  // a crate (its box tall: the open lid and the card stand up out of it) and a board on its tray, the ray from in front
  // and above, through the crate's box first and then the board's
  const make = (): Picking => {
    const p = new Picking();
    p.add('crate', at(0, 0.5, 0), { box: box([0.4, 0.5, 0.4]), pad: 0 });
    p.add('board', at(0, 0.45, 0.1), { box: box([0.28, 0.05, 0.19]), pad: 0 });
    return p;
  };
  const ray = new Ray(new Vector3(0, 3, 4), new Vector3(0, 0.45, 0.1).sub(new Vector3(0, 3, 4)).normalize());
  it('without the rule the nearer box wins', () => {
    expect(make().pick(ray)?.id).toBe('crate');
  });
  it('with it the board wins, at its own hit point; and only while the rule says so', () => {
    const p = make();
    let on = true;
    p.prefer('board', () => (on ? ['crate'] : []));
    const h = p.pick(ray)!;
    expect(h.id).toBe('board');
    expect(h.point.y).toBeCloseTo(0.5, 6);
    on = false;
    expect(p.pick(ray)?.id).toBe('crate');
  });
  it('a ray that misses the board is the crate\'s still (taken by its sides)', () => {
    const p = make();
    p.prefer('board', () => ['crate']);
    const side = new Ray(new Vector3(3, 0.3, 0), new Vector3(-1, 0, 0));
    expect(p.pick(side)?.id).toBe('crate');
  });
});
