// The beacon and the sparks (W3 round 2): within their triangle caps, and their poses move only what they say.
import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D } from 'three';
import { countTriangles } from '../../../src/workshop/view/kit/compose.ts';
import { beacon, beaconMatrices, HIDDEN as BH } from '../../../src/workshop/view/kit/pieces/beacon/index.ts';
import { sparks, sparkMatrix, SPARKS } from '../../../src/workshop/view/kit/pieces/sparks/index.ts';

describe('beacon', () => {
  it('is at most 700 triangles, high and low', () => {
    expect(countTriangles(beacon())).toBeLessThanOrEqual(700);
    expect(countTriangles(beacon({ detail: 'low' }))).toBeLessThanOrEqual(700);
  });
  it('lit shows the mirror and hides the dark dome, and turns about Y', () => {
    const m = { mirror: new Matrix4(), unlit: new Matrix4() };
    beaconMatrices({ lit: true, angle: 1 }, m);
    const s = new Object3D();
    m.mirror.decompose(s.position, s.quaternion, s.scale);
    expect(s.scale.x).toBeCloseTo(1);
    m.unlit.decompose(s.position, s.quaternion, s.scale);
    expect(s.scale.x).toBeCloseTo(BH);
    beaconMatrices({ lit: false }, m);
    m.mirror.decompose(s.position, s.quaternion, s.scale);
    expect(s.scale.x).toBeCloseTo(BH);
  });
});

describe('sparks', () => {
  it('is at most 200 triangles', () => {
    expect(countTriangles(sparks())).toBeLessThanOrEqual(200);
  });
  it('a burst is seeded, falls, and is gone after its life', () => {
    const a = sparkMatrix(3, { t: 0.2, seed: 5 }, new Matrix4());
    const b = sparkMatrix(3, { t: 0.2, seed: 5 }, new Matrix4());
    expect(a.equals(b)).toBe(true);
    const o = new Object3D();
    sparkMatrix(3, { t: SPARKS.life[1] + 0.1, seed: 5 }, new Matrix4()).decompose(o.position, o.quaternion, o.scale);
    expect(o.scale.y).toBeLessThan(1e-3);
    sparkMatrix(3, { t: -0.1, seed: 5 }, new Matrix4()).decompose(o.position, o.quaternion, o.scale);
    expect(o.scale.y).toBeLessThan(1e-3);
  });
});
