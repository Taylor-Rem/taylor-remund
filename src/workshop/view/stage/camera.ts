/**
 * The camera rig (REWRITE.md § B6, art-direction § 3): a long lens at a
 * fixed pitch, looking at the bench from the front and a little above. No
 * orbit. Its state is a focus point and a zoom:
 *
 *   zoom 0 = the whole subject (the box given to `setSubject`)
 *   zoom 1 = one station (a box about `stationSize` across)
 *
 * Distance is interpolated in log space between the two, so each wheel notch
 * feels the same. Everything here is plain maths on three's math classes and
 * runs in Node for tests; nothing touches the DOM.
 */
import { Box3, MathUtils, PerspectiveCamera, Ray, Vector2, Vector3 } from 'three';

export interface View {
  /** The point the camera looks at (world space; usually on or near the bench). */
  focus: readonly [number, number, number];
  /** 0 = whole subject, 1 = one station. Values outside are clamped. */
  zoom: number;
}

export interface CameraRigOptions {
  /** Vertical field of view, degrees (long lens: 18-22). */
  fov?: number;
  /** Downward pitch, degrees (30-36). */
  pitch?: number;
  /** Fraction of the frame kept free round a fitted box, per side. */
  margin?: number;
  /** Size of the box zoom 1 fits (a station). */
  stationSize?: number;
  reducedMotion?: boolean;
}

export interface FrameOptions {
  /**
   * The bench's front edge (height and z). With spare height in the frame
   * (a portrait phone), the view slides toward the visitor until this edge
   * sits near the bottom, instead of showing empty room below the bench.
   */
  edge?: { y: number; z: number };
}

/** The camera looks along this (unit) direction: down by `pitch`, toward −Z. */
export function viewDirection(pitchDeg: number, out = new Vector3()): Vector3 {
  const p = MathUtils.degToRad(pitchDeg);
  return out.set(0, -Math.sin(p), -Math.cos(p));
}

/**
 * The distance from `target` (along −dir) at which every corner of `box`
 * projects inside the frame, keeping `margin` free per side. Exact for the
 * fixed orientation: for a corner at offset o from the target, with camera
 * axes r (right), u (up), f (forward), it needs
 *   |o·r| ≤ tanH (D + o·f)  and  |o·u| ≤ tanV (D + o·f).
 * Fitting both is what makes a portrait phone fit by its narrower side.
 */
export function fitDistance(box: Box3, target: Vector3, fovDeg: number, aspect: number, pitchDeg: number, margin = 0.06): number {
  const f = viewDirection(pitchDeg);
  const r = new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(r, f).negate(); // up = f × r … sign so u.y > 0
  if (u.y < 0) u.negate();
  const tanV = Math.tan(MathUtils.degToRad(fovDeg) / 2) * (1 - 2 * margin);
  const tanH = Math.tan(MathUtils.degToRad(fovDeg) / 2) * aspect * (1 - 2 * margin);
  let d = 0;
  const c = new Vector3();
  for (let i = 0; i < 8; i++) {
    c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
    const along = c.dot(f);
    d = Math.max(d, Math.abs(c.dot(r)) / tanH - along, Math.abs(c.dot(u)) / tanV - along);
  }
  return d;
}

/** The point to look at so a box sits centred in the frame: its centre. */
export function boxTarget(box: Box3, out = new Vector3()): Vector3 {
  return box.getCenter(out);
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Margin past the bounds the view may show, as a fraction of the frame's width. */
const PAN_MARGIN = 0.03;
/** How far the rubber band gives past a pan limit, as a fraction of the frame's height (about 10 px at 900). */
const PAN_GIVE = 0.012;

/** Clamp v to [lo, hi], letting it past by at most `give`, with resistance growing toward that. */
export function rubber(v: number, lo: number, hi: number, give: number): number {
  if (v >= lo && v <= hi) return v;
  const edge = v < lo ? lo : hi;
  const e = Math.abs(v - edge);
  if (give <= 0) return edge;
  const g = give * (1 - Math.exp(-e / give));
  return v < lo ? lo - g : hi + g;
}

export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly fov: number;
  readonly pitch: number;
  readonly margin: number;
  stationSize: number;
  reducedMotion: boolean;

  /** Current state. */
  readonly focus = new Vector3();
  zoom = 0;

  /** The subject (zoom 0) and the pan limits for the focus. */
  readonly subject = new Box3(new Vector3(-10, 0, -5), new Vector3(10, 4, 5));
  readonly bounds = new Box3(new Vector3(-10, -1, -5), new Vector3(10, 4, 5));

  private aspect = 16 / 10;
  private wideDistance = 40;
  private closeDistance = 12;
  private readonly dir = new Vector3();

  private ease: { from: View; to: View; t: number; dur: number } | null = null;
  private shakeAmp = 0;
  private shakeVel = 0;
  private shakeTime = 0;
  private readonly shakeOffset = new Vector3();

  constructor(opts: CameraRigOptions = {}) {
    this.fov = opts.fov ?? 20;
    this.pitch = opts.pitch ?? 33;
    this.margin = opts.margin ?? 0.06;
    this.stationSize = opts.stationSize ?? 3.6;
    this.reducedMotion = opts.reducedMotion ?? false;
    this.camera = new PerspectiveCamera(this.fov, this.aspect, 1, 200);
    viewDirection(this.pitch, this.dir);
    this.setSubject(this.subject);
  }

  /** Distance from the focus for the current zoom. */
  get distance(): number {
    const z = MathUtils.clamp(this.zoom, 0, 1);
    return Math.exp(MathUtils.lerp(Math.log(this.wideDistance), Math.log(this.closeDistance), z));
  }

  /** The zoom that gives this distance (may be outside 0..1 before clamping). */
  zoomForDistance(d: number): number {
    const a = Math.log(this.wideDistance);
    const b = Math.log(this.closeDistance);
    return a === b ? 0 : (Math.log(d) - a) / (b - a);
  }

  setAspect(aspect: number): void {
    if (!(aspect > 0)) return;
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.recomputeRange();
    this.apply();
  }

  /**
   * What zoom 0 shows (its home view, fitted at the current aspect; refitted
   * on every aspect change). Also sets the pan bounds to the box's footprint
   * unless `bounds` is given.
   */
  setSubject(box: Box3, opts: FrameOptions & { bounds?: Box3 } = {}): void {
    this.subject.copy(box);
    this.bounds.copy(opts.bounds ?? box);
    this.subjectOpts = opts;
    this.recomputeRange();
    this.apply();
  }

  /** The zoom-0 view: the subject fitted, with its front-edge option applied. */
  home(): View {
    return { focus: [this.homeFocus.x, this.homeFocus.y, this.homeFocus.z], zoom: 0 };
  }

  private subjectOpts: FrameOptions = {};
  private readonly homeFocus = new Vector3();

  private recomputeRange(): void {
    const c = boxTarget(this.subject, new Vector3());
    // Fit first without the edge slide to know the distance, then place home.
    this.wideDistance = Number.POSITIVE_INFINITY;
    this.closeDistance = 1;
    const v = this.frame(this.subject, this.subjectOpts);
    this.homeFocus.set(v.focus[0], v.focus[1], v.focus[2]);
    this.wideDistance = fitDistance(this.subject, c, this.fov, this.aspect, this.pitch, this.margin);
    const h = this.stationSize / 2;
    const station = new Box3(new Vector3(-h, 0, -h * 0.6), new Vector3(h, this.stationSize * 0.7, h * 0.6));
    this.closeDistance = Math.min(this.wideDistance, fitDistance(station, boxTarget(station, new Vector3()), this.fov, this.aspect, this.pitch, this.margin));
  }

  /** The view that fits `box` in the frame at the current aspect. */
  frame(box: Box3, opts: FrameOptions = {}): View {
    const t = boxTarget(box, new Vector3());
    const d = fitDistance(box, t, this.fov, this.aspect, this.pitch, this.margin);
    if (opts.edge) {
      // When the box fits by width (a portrait phone) there is spare height
      // below it: the room under the bench. Slide the view back (camera and
      // focus together, −z) until the bench's front edge sits at the bottom
      // of the frame, so the spare height shows bench and wall instead.
      const edge = new Vector3(t.x, opts.edge.y, opts.edge.z);
      const ndcY = (p: Vector3, dz: number): number => this.projectFrom(t.x, t.y, t.z - dz, d, p).y;
      const want = -1 + this.margin;
      if (ndcY(edge, 0) > want) {
        let lo = 0;
        let hi = Math.max(1, box.max.z - box.min.z) * 4;
        for (let i = 0; i < 32; i++) {
          const mid = (lo + hi) / 2;
          if (ndcY(edge, mid) > want) lo = mid;
          else hi = mid;
        }
        t.z -= lo;
      }
    }
    return { focus: [t.x, t.y, t.z], zoom: this.zoomForDistance(d) };
  }

  /** NDC of a world point seen from a camera at this focus and distance (the rig's orientation and aspect). */
  private projectFrom(fx: number, fy: number, fz: number, d: number, p: Vector3): Vector3 {
    const cam = this.scratch;
    cam.fov = this.fov;
    cam.aspect = this.aspect;
    cam.near = 0.1;
    cam.far = d * 4 + 100;
    cam.updateProjectionMatrix();
    cam.position.set(fx, fy, fz).addScaledVector(this.dir, -d);
    cam.lookAt(fx, fy, fz);
    cam.updateMatrixWorld(true);
    return p.clone().project(cam);
  }
  private readonly scratch = new PerspectiveCamera();

  /** The current view. */
  view(): View {
    return { focus: [this.focus.x, this.focus.y, this.focus.z], zoom: this.zoom };
  }

  /** Jump to a view. */
  cutTo(v: View): void {
    this.ease = null;
    this.focus.set(v.focus[0], v.focus[1], v.focus[2]);
    this.zoom = v.zoom;
    this.clampState();
    this.apply();
  }

  /** Glide to a view (a cut when reduced motion is on). */
  easeTo(v: View, seconds = 0.7): void {
    if (this.reducedMotion || seconds <= 0) {
      this.cutTo(v);
      return;
    }
    this.ease = { from: this.view(), to: { focus: [...v.focus] as [number, number, number], zoom: v.zoom }, t: 0, dur: seconds };
  }

  /** Slide the focus along the bench (world units; +x right, +z toward the visitor). */
  panBy(dx: number, dz = 0): void {
    this.ease = null;
    // Past a limit the drag meets resistance: only the give is let through.
    const r = this.panRange();
    const over = (v: number, lo: number, hi: number): number => (v < lo ? lo - v : v > hi ? v - hi : 0);
    const resist = (v: number, dv: number, lo: number, hi: number): number => (over(v + dv, lo, hi) > over(v, lo, hi) ? dv * 0.35 : dv);
    this.focus.x += resist(this.focus.x, dx, r.x[0], r.x[1]);
    this.focus.z += resist(this.focus.z, dz, r.z[0], r.z[1]);
    this.clampState(true);
    this.apply();
  }

  /**
   * Zoom by a factor of distance (f < 1 moves in). With `towardNdc`, the bench
   * point under that screen position stays under it, the way a map zooms
   * toward the pointer.
   */
  zoomBy(f: number, towardNdc?: { x: number; y: number }): void {
    if (!(f > 0)) return;
    this.ease = null;
    const before = towardNdc ? this.benchPoint(towardNdc, this.focus.y) : null;
    this.zoom = MathUtils.clamp(this.zoomForDistance(this.distance * f), 0, 1);
    this.apply();
    if (before && towardNdc) {
      const after = this.benchPoint(towardNdc, this.focus.y);
      if (after) {
        this.focus.x += before.x - after.x;
        this.focus.z += before.z - after.z;
      }
    }
    this.clampState();
    this.apply();
  }

  /** A small damped shake (the Button). Ignored under reduced motion. */
  shake(amount = 0.05): void {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeVel = 0;
    this.shakeTime = 0;
  }

  /** A ray from the camera through a point in normalised device coordinates. */
  screenToRay(ndc: { x: number; y: number }, out = new Ray()): Ray {
    out.origin.setFromMatrixPosition(this.camera.matrixWorld);
    out.direction.set(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(out.origin).normalize();
    return out;
  }

  /** Where a world point lands: NDC (−1..1, y up) and depth (0..1 inside the frustum). */
  worldToScreen(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const v = new Vector3(p.x, p.y, p.z).project(this.camera);
    return { x: v.x, y: v.y, z: v.z };
  }

  /** The point on the horizontal plane y = h under an NDC position, or null if the ray misses it. */
  benchPoint(ndc: { x: number; y: number }, h = 0): Vector3 | null {
    const ray = this.screenToRay(ndc);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (h - ray.origin.y) / ray.direction.y;
    return t > 0 ? ray.at(t, new Vector3()) : null;
  }

  /**
   * Where the depth of field focuses. By default: where the centre of the
   * frame meets the plane y = `focusHeight` (about half a robot above the
   * bench), so whatever sits in the middle of the picture is sharp at any
   * zoom. `focusOn(p)` pins it to a world point instead (a framed station);
   * `focusOn(null)` returns to the default.
   */
  focusHeight = 0.5;
  private pinnedFocus: Vector3 | null = null;

  focusOn(p: { x: number; y: number; z: number } | null): void {
    this.pinnedFocus = p ? new Vector3(p.x, p.y, p.z) : null;
  }

  /** Distance from the camera to the plane of sharp focus, along the view direction. */
  focusDistance(): number {
    const cam = this.camera.position;
    if (this.pinnedFocus) return Math.max(0.1, this.pinnedFocus.clone().sub(cam).dot(this.dir));
    const dy = this.dir.y;
    if (Math.abs(dy) < 1e-6) return this.distance;
    const t = (this.focusHeight - cam.y) / dy;
    return t > 0 ? t : this.distance;
  }

  /** Advance easing and shake. `dt` in seconds. */
  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1);
    if (this.ease) {
      const e = this.ease;
      e.t = Math.min(1, e.t + step / e.dur);
      const k = smooth(e.t);
      this.focus.set(
        MathUtils.lerp(e.from.focus[0], e.to.focus[0], k),
        MathUtils.lerp(e.from.focus[1], e.to.focus[1], k),
        MathUtils.lerp(e.from.focus[2], e.to.focus[2], k),
      );
      this.zoom = MathUtils.lerp(e.from.zoom, e.to.zoom, k);
      if (e.t >= 1) this.ease = null;
      this.clampState();
    }
    if (!this.ease && this.stretched) {
      // The rubber band springs back to the pan range.
      const r = this.panRange();
      const k = 1 - Math.exp(-14 * step);
      this.focus.x += (MathUtils.clamp(this.focus.x, r.x[0], r.x[1]) - this.focus.x) * k;
      this.focus.z += (MathUtils.clamp(this.focus.z, r.z[0], r.z[1]) - this.focus.z) * k;
      if (Math.abs(MathUtils.clamp(this.focus.x, r.x[0], r.x[1]) - this.focus.x) < 1e-4 && Math.abs(MathUtils.clamp(this.focus.z, r.z[0], r.z[1]) - this.focus.z) < 1e-4) this.clampState();
    }
    if (this.shakeAmp > 1e-4) {
      // A damped spring on the amplitude, sampled as two incommensurate sines.
      this.shakeTime += step;
      this.shakeVel += (-90 * this.shakeAmp - 9 * this.shakeVel) * step;
      this.shakeAmp = Math.max(0, this.shakeAmp + this.shakeVel * step);
      const a = this.shakeAmp;
      this.shakeOffset.set(Math.sin(this.shakeTime * 61) * a, Math.sin(this.shakeTime * 47 + 1.3) * a * 0.7, 0);
    } else {
      this.shakeAmp = 0;
      this.shakeOffset.set(0, 0, 0);
    }
    this.apply();
  }

  get easing(): boolean {
    return this.ease !== null;
  }

  /**
   * Where the focus may be at the current zoom and aspect: wherever the view
   * still stays inside `bounds` plus a small margin. Across the bench (x): the
   * frame's half-width at the focus distance must fit inside the bounds. Along
   * it (z): the focus stays over the bounds and the frame's bottom edge (the
   * bench plane under the bottom of the picture) does not run past the front.
   * When the view already shows the whole width there is nowhere to go: the
   * range collapses onto the home focus. Home is always inside the range.
   */
  panRange(): { x: [number, number]; z: [number, number] } {
    const d = this.distance;
    const b = this.bounds;
    const tanV = Math.tan(MathUtils.degToRad(this.fov) / 2);
    const halfW = tanV * this.aspect * d;
    const mx = halfW * 2 * PAN_MARGIN;
    const home = this.homeFocus;
    // home is always a valid focus, and with nowhere to pan the range IS home. Clamping home into
    // [hi, lo] (and clamping it out of a range that had only just opened) moved an adopted view
    // by up to ~27 px at aspects near 1.85-2.0, where lo crosses hi.
    const range = (lo: number, hi: number, h: number): [number, number] => (lo <= hi ? [Math.min(lo, h), Math.max(hi, h)] : [h, h]);
    const x = range(b.min.x + halfW - mx, b.max.x - halfW + mx, home.x);
    // The bench point under the bottom of the frame, relative to the focus (translation-invariant).
    const planeY = this.subjectOpts.edge?.y ?? this.subject.min.y;
    const p = this.projectFromRay(this.focus.y, d, -1, planeY);
    const nearOffset = p === null ? 0 : p - 0; // z of the bottom edge minus focus z
    const front = (this.subjectOpts.edge?.z ?? b.max.z) + mx;
    const z = range(b.min.z, Math.min(b.max.z, front - nearOffset), home.z);
    return { x, z };
  }

  /** z offset (from the focus) where the ray through NDC (0, ndcY) meets the plane y = planeY, for a focus at height fy and distance d. */
  private projectFromRay(fy: number, d: number, ndcY: number, planeY: number): number | null {
    const cam = this.scratch;
    cam.fov = this.fov;
    cam.aspect = this.aspect;
    cam.near = 0.1;
    cam.far = d * 4 + 100;
    cam.updateProjectionMatrix();
    cam.position.set(0, fy, 0).addScaledVector(this.dir, -d);
    cam.lookAt(0, fy, 0);
    cam.updateMatrixWorld(true);
    const o = cam.position;
    const dir = new Vector3(0, ndcY, 0.5).unproject(cam).sub(o).normalize();
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (planeY - o.y) / dir.y;
    return t > 0 ? o.z + dir.z * t : null;
  }

  /**
   * Keep the focus inside the pan range. `soft`: allow a little rubber-band
   * give past the limit (it springs back in `update`); none under reduced motion.
   */
  private clampState(soft = false): void {
    this.zoom = MathUtils.clamp(this.zoom, 0, 1);
    const r = this.panRange();
    const give = soft && !this.reducedMotion ? Math.tan(MathUtils.degToRad(this.fov) / 2) * this.distance * 2 * PAN_GIVE : 0;
    this.focus.x = rubber(this.focus.x, r.x[0], r.x[1], give);
    this.focus.z = rubber(this.focus.z, r.z[0], r.z[1], give);
    this.focus.y = MathUtils.clamp(this.focus.y, this.bounds.min.y - 1, this.bounds.max.y);
  }

  /** True while the focus sits past its pan range (the rubber band is stretched). */
  get stretched(): boolean {
    const r = this.panRange();
    const e = 1e-6;
    return this.focus.x < r.x[0] - e || this.focus.x > r.x[1] + e || this.focus.z < r.z[0] - e || this.focus.z > r.z[1] + e;
  }

  /** Place the camera from the state. */
  private apply(): void {
    const d = this.distance;
    const cam = this.camera;
    cam.position.copy(this.focus).addScaledVector(this.dir, -d);
    cam.lookAt(this.focus);
    if (this.shakeAmp > 0) {
      cam.position.addScaledVector(new Vector3(1, 0, 0), this.shakeOffset.x * d * 0.02);
      cam.position.y += this.shakeOffset.y * d * 0.02;
    }
    // Tight near/far for depth precision (the post chain reads depth).
    const r = this.subject.getSize(new Vector3()).length() * 0.5 + 4;
    cam.near = Math.max(0.5, d - r * 1.2);
    cam.far = d + r * 2.5;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /** NDC of the pointer from a pixel position in an element of this size. */
  static ndc(px: number, py: number, width: number, height: number, out = new Vector2()): Vector2 {
    return out.set((px / width) * 2 - 1, -(py / height) * 2 + 1);
  }
}
