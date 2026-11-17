/**
 * Small vector and quaternion helpers on the contract's tuple types. Pure
 * functions, no allocation tricks: the simulation has a handful of bodies.
 */
import type { Pose, Quat, Vec3 } from './types.ts';

export const ZERO: Vec3 = [0, 0, 0];
export const IDENTITY: Quat = [0, 0, 0, 1];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** `a` scaled down so its length is at most `max`. */
export function clampLength(a: Vec3, max: number): Vec3 {
  const l = length(a);
  return l > max && l > 0 ? scale(a, max / l) : a;
}

export const finiteVec = (a: Vec3): boolean => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);
export const finitePose = (p: Pose): boolean => finiteVec(p.p) && p.q.every(Number.isFinite);

export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export function qnormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Rotation of `angle` radians about the unit `axis`. */
export function qaxis(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Rotation about +Y (heading; 0 faces +Z). */
export const qyaw = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/** Rotate `v` by `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** The yaw (about +Y) of the direction `q` turns +Z to. */
export function yawOf(q: Quat): number {
  const f = rotate(q, [0, 0, 1]);
  return Math.atan2(f[0], f[2]);
}

/** Axis-angle of `q` as a rotation vector (axis * angle), shortest way round. */
export function rotationVector(q: Quat): Vec3 {
  let [x, y, z, w] = qnormalize(q);
  if (w < 0) [x, y, z, w] = [-x, -y, -z, -w];
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return [2 * x, 2 * y, 2 * z];
  const angle = 2 * Math.atan2(s, w);
  return [(x / s) * angle, (y / s) * angle, (z / s) * angle];
}

/** Angle in radians between two orientations. */
export function qangle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

export const pose = (p: Vec3, q: Quat = IDENTITY): Pose => ({ p, q });
