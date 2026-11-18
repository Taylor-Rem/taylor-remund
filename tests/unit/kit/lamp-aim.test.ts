import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { aimLamp, armFrames, inReach, nearestInReach, landing, HOME, JOINTS, LIMITS, REACH, AIM_TARGETS, leanFor } from '../../../src/workshop/view/kit/pieces/lamp/aim.ts';
import type { Joint } from '../../../src/workshop/view/kit/pieces/lamp/aim.ts';
import { stageTarget } from '../../../src/workshop/view/kit/pieces/lamp/rig.ts';

const DEG = Math.PI / 180;

/**
 * Where the arm must never be, in the lamp's space (bench layout: the lamp clamped at world x -3.1;
 * the vignette's neighbours are further off). Returns what was hit, or null.
 */
function collides(pose: Record<Joint, number>): string | null {
  const f = armFrames(pose);
  const pts: Vector3[] = [];
  for (let k = 0.15; k <= 1.0001; k += 0.05) pts.push(f.shoulder.clone().lerp(f.elbow, k));
  for (let k = 0; k <= 1.0001; k += 0.05) pts.push(f.elbow.clone().lerp(f.wrist, k));
  const ax = f.axis, u = new Vector3().crossVectors(ax, new Vector3(0, 1, 0)).normalize(), w = new Vector3().crossVectors(ax, u);
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    // the shade's rim and the back of its bell
    pts.push(f.wrist.clone().addScaledVector(ax, 1.22).addScaledVector(u, Math.cos(t) * 0.63).addScaledVector(w, Math.sin(t) * 0.63));
    pts.push(f.wrist.clone().addScaledVector(ax, 0.5).addScaledVector(u, Math.cos(t) * 0.3).addScaledVector(w, Math.sin(t) * 0.3));
  }
  for (const p of pts) {
    if (p.z < 0.2) return 'the wall';
    if (p.x < -1.3 && p.y < 4.6 && p.z < 0.65) return 'the tool wall';
    if (p.x > -0.2 && p.x < 8.8 && p.y > 3.2 && p.y < 6.5 && p.z < 0.75) return 'the sign';
    if (p.y < 1.8) return 'the bench (and what stands on it)';
    if (p.x > 1.2 && p.x < 6.1 && p.y < 3.4 && p.z < 1.6) return 'the switchboard';
  }
  return null;
}

describe('aiming the lamp', () => {
  it('gives the approved home pose for the home spot, exactly', () => {
    const a = aimLamp(stageTarget().aim);
    for (const k of JOINTS) expect(a.pose[k], k).toBeCloseTo(HOME[k], 9);
    expect(a.reached).toBe(true);
    expect(leanFor(HOME.swivel)).toBeCloseTo(HOME.lean, 12);
  });

  it('REACH is convex, holds the home spot, and every spot in it is lit exactly, within limits, clear of everything', () => {
    // convex: every turn the same way
    const n = REACH.length;
    let sgn = 0;
    for (let i = 0; i < n; i++) {
      const [ax, az] = REACH[i]!, [bx, bz] = REACH[(i + 1) % n]!, [cx, cz] = REACH[(i + 2) % n]!;
      const c = Math.sign((bx - ax) * (cz - bz) - (bz - az) * (cx - bx));
      if (!sgn) sgn = c;
      expect(c).toBe(sgn);
    }
    const h = stageTarget().aim;
    expect(inReach(h[0], h[2])).toBe(true);
    let tested = 0;
    const bad: string[] = [];
    for (let x = -5.8; x <= 11.91; x += 0.25) {
      for (let z = 0.6; z <= 10.001; z += 0.25) {
        if (!inReach(x, z)) continue;
        tested++;
        const a = aimLamp([x, 0, z]);
        if (!a.reached) bad.push(`${x},${z}: not reached`);
        if (new Vector3(...a.lands).distanceTo(new Vector3(x, 0, z)) > 1e-3) bad.push(`${x},${z}: lands off`);
        for (const k of JOINTS) if (a.pose[k] < LIMITS[k].min - 1e-9 || a.pose[k] > LIMITS[k].max + 1e-9) bad.push(`${x},${z}: ${k}`);
        const c = collides(a.pose);
        if (c) bad.push(`${x},${z}: ${c}`);
        // the light comes down onto the bench, never grazing along it
        if (a.axis[1] > -Math.sin(25 * DEG)) bad.push(`${x},${z}: grazing`);
      }
    }
    expect(tested).toBeGreaterThan(2000);
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('out of reach, gives the nearest spot it can and says where the beam lands', () => {
    const far = AIM_TARGETS['far-right'];
    const a = aimLamp(far);
    expect(a.reached).toBe(false);
    expect(inReach(a.target[0], a.target[2])).toBe(true);
    // the beam lands on the target it solved for, and that is the nearest point of REACH
    expect(new Vector3(...a.lands).distanceTo(new Vector3(...a.target))).toBeLessThan(1e-3);
    expect(new Vector3(...a.target).distanceTo(nearestInReach(new Vector3(...far)))).toBeLessThan(1e-9);
    // what it says is the truth of the pose
    expect(landing(armFrames(a.pose), far[1]).distanceTo(new Vector3(...a.lands))).toBeLessThan(1e-6);
    // and even a spot far off the bench gives a pose inside the limits, clear of everything
    for (const t of [[-40, 0, 3], [30, 0, -5], [0, 0, -20], [2, 0, 60]] as const) {
      const b = aimLamp([...t]);
      for (const k of JOINTS) expect(b.pose[k]).toBeGreaterThanOrEqual(LIMITS[k].min - 1e-9);
      expect(collides(b.pose)).toBe(null);
    }
  });

  it('moves every joint continuously as the spot moves continuously (no flips, no pops)', () => {
    const drags: Array<[[number, number], [number, number]]> = [
      [[-5.5, 6], [11.7, 6]], // the brief's long drag, far left to far right
      [[-5.8, 1], [10, 1]], // along the wall
      [[0.3, 0.6], [0.3, 10]], // straight out from the clamp
      [[-8, 12], [14, -2]], // a diagonal that leaves REACH at both ends
      [[11.7, 9.6], [-5.5, 0.8]],
    ];
    for (const [a, b] of drags) {
      const N = 2000;
      const step = Math.hypot(b[0] - a[0], b[1] - a[1]) / N;
      let prev: Record<Joint, number> | null = null;
      let worst = 0;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = aimLamp([a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t]).pose;
        if (prev) for (const k of JOINTS) worst = Math.max(worst, Math.abs(p[k] - prev[k]));
        prev = p;
      }
      // a joint never turns faster than 40 degrees per unit the spot moves (near the clamp the swivel is quickest)
      expect(worst / step / DEG, JSON.stringify([a, b])).toBeLessThan(40);
    }
  });

  it('names its review spots, all but the far right corner within reach', () => {
    for (const [name, t] of Object.entries(AIM_TARGETS)) expect(aimLamp(t).reached, name).toBe(name !== 'far-right');
  });
});
