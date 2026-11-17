/**
 * 2D outlines for the loft core: profiles (the side view of a turned or
 * bevelled part) and loops (the plan view, or a sweep's cross-section).
 *
 * PROFILE. Coordinates are (o, y): o is the outward offset (for a lathe,
 * the radius; for a rounded box, the distance out from its core), y is the
 * height (for a sweep, the distance along the path). Write it with the
 * material on the LEFT of travel: a lathe profile starts on the axis at the
 * bottom, goes out, up, and back to the axis at the top. Each point may
 * carry a corner treatment (fillet radius, chamfer, sharp, smooth); helpers
 * make shoulders, grooves, beads, flares and domes one call each. Fillets
 * get analytic normals and at least one interior sample (the wear signal
 * peaks there and falls to zero at the tangent lines, so it stays a line);
 * sharp corners and chamfers get crease (split) normals.
 *
 * LOOP. A closed (or open, for a partial sweep angle) ring of samples in a
 * plane (x, z). Each sample has a core point p, an offset direction m and a
 * shading normal n; the loft places it at p + o·m. A lathe's loop is the
 * centre point with m = n round a circle; a rounded box's loop is the core
 * rectangle's four corners with m = n sweeping each corner (a Minkowski
 * sum, so every offset is a true rounded rectangle); an extruded outline's
 * loop is its own points with mitred m.
 */

export interface Corner {
  /** Round this corner with a circular fillet of this radius. */
  fillet?: number;
  /** Cut this corner with a flat chamfer of this leg length (crisp). */
  chamfer?: number;
  /** Force a crease here (split normals) even if the turn is shallow. */
  sharp?: boolean;
  /** Force smooth normals here even if the turn is steep. */
  smooth?: boolean;
  /** Fillet segments for a 90° turn (scaled by angle). */
  segs?: number;
}

/** One expanded profile sample: position and 2D normal. Creases appear as two samples at the same position. */
export interface PSample {
  o: number;
  y: number;
  no: number;
  ny: number;
}

interface PNode {
  o: number;
  y: number;
  c?: Corner | undefined;
  /** Given analytic normal (curve samples). */
  n?: [number, number] | undefined;
  /** Part of a smooth curve: never creased. */
  curve?: boolean;
}

const DEFAULT_CREASE_DEG = 40;

/** Global detail multiplier applied while expanding (set by the kit's 'low' path). */
export interface ExpandOptions {
  /** Multiplies every fillet's segment count (0.5 for 'low'). */
  detail?: number;
  /** Most fillet segments per 90° (default 6). Unmarked fillets get a count from their radius: 1 + 45·r, so small fillets stay cheap. */
  segs?: number;
  /** Turn angle above which an unmarked corner creases. */
  creaseDeg?: number;
  /** Insert support samples beside fillets and chamfers (default false: wear peaks inside fillets on its own). */
  support?: boolean;
  /**
   * Wear band: put a ring of samples this far onto each flat run beside a fillet or chamfer,
   * so the wear that `finish` spreads from an edge falls to zero across a band of the face
   * instead of across the whole face (0 = no band rings). Runs too short for a ring get none.
   */
  band?: number;
}

/** Fillet segments per 90° for a radius (world units): 1 + 45·r, clamped. */
export function autoSegs(r: number, max = 6): number {
  return Math.max(r < 0.008 ? 1 : 2, Math.min(max, Math.round(1 + r * 45)));
}

export class Profile {
  readonly nodes: PNode[] = [];
  closed = false;

  constructor(o: number, y: number) {
    this.nodes.push({ o, y });
  }

  private get last(): PNode {
    const l = this.nodes[this.nodes.length - 1];
    if (!l) throw new Error('empty profile');
    return l;
  }

  get o(): number {
    return this.last.o;
  }
  get y(): number {
    return this.last.y;
  }

  /** Line to an absolute point. */
  to(o: number, y: number, c?: Corner): this {
    this.nodes.push({ o, y, c });
    return this;
  }
  /** Line by a relative amount. */
  by(dO: number, dY: number, c?: Corner): this {
    return this.to(this.o + dO, this.y + dY, c);
  }
  up(d: number, c?: Corner): this {
    return this.by(0, d, c);
  }
  down(d: number, c?: Corner): this {
    return this.by(0, -d, c);
  }
  out(d: number, c?: Corner): this {
    return this.by(d, 0, c);
  }
  in(d: number, c?: Corner): this {
    return this.by(-d, 0, c);
  }

  /** Set the corner treatment of the last point. */
  corner(c: Corner): this {
    this.last.c = { ...this.last.c, ...c };
    return this;
  }
  /** Fillet the last point. */
  round(r: number, segs?: number): this {
    return this.corner(segs === undefined ? { fillet: r } : { fillet: r, segs });
  }
  /** Chamfer the last point. */
  chamfer(c: number): this {
    return this.corner({ chamfer: c });
  }
  sharp(): this {
    return this.corner({ sharp: true });
  }
  smooth(): this {
    return this.corner({ smooth: true });
  }

  /** A shoulder: out by dO then up by dY, the inside corner filleted r, the outside corner r2. */
  step(dO: number, dY: number, r = 0, r2 = r): this {
    this.out(dO, r > 0 ? { fillet: r } : undefined);
    return this.up(dY, r2 > 0 ? { fillet: r2 } : undefined);
  }

  /** Direction of the last segment (unit), or +y if none. */
  private heading(): [number, number] {
    const a = this.nodes[this.nodes.length - 2];
    const b = this.last;
    if (!a) return [0, 1];
    const l = Math.hypot(b.o - a.o, b.y - a.y) || 1;
    return [(b.o - a.o) / l, (b.y - a.y) / l];
  }

  /**
   * A groove cut into the material, continuing along the current heading:
   * in by `depth`, along by `width`, back out. Bottom corners filleted `r`,
   * the lips `lip` (defaults to r/2). Assumes material-on-the-left.
   */
  groove(depth: number, width: number, r = Math.min(depth, width) * 0.4, lip = r * 0.5): this {
    const [dx, dy] = this.heading();
    const ix = -dy, iy = dx; // left of travel = into material
    if (lip > 0) this.round(lip);
    this.by(ix * depth, iy * depth, r > 0 ? { fillet: r } : undefined);
    this.by(dx * width, dy * width, r > 0 ? { fillet: r } : undefined);
    this.by(-ix * depth, -iy * depth, lip > 0 ? { fillet: lip } : undefined);
    return this;
  }

  /** A raised half-round bead standing out of the wall by `height` over `width`, continuing along the heading. */
  bead(height: number, width: number, segs = 6): this {
    const [dx, dy] = this.heading();
    const ox = dy, oy = -dx; // right of travel = out of material
    const s = this.last;
    const sx = s.o, sy = s.y;
    s.c = { ...s.c, sharp: true };
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const a = Math.PI * t;
      const along = width * t;
      const outv = height * Math.sin(a);
      this.nodes.push({ o: sx + dx * along + ox * outv, y: sy + dy * along + oy * outv, curve: true });
    }
    this.nodes.push({ o: sx + dx * width, y: sy + dy * width, c: { sharp: true } });
    return this;
  }

  /** Quadratic curve to (o, y) with control point (co, cy). Smooth throughout. */
  curve(o: number, y: number, co: number, cy: number, segs = 8, c?: Corner): this {
    const s = this.last;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
      const node: PNode = { o: a * s.o + b * co + d * o, y: a * s.y + b * cy + d * y, curve: i < segs };
      if (i === segs && c) node.c = c;
      this.nodes.push(node);
    }
    return this;
  }

  /** Cubic curve to (o, y) with controls (c1o, c1y), (c2o, c2y). */
  cubic(o: number, y: number, c1o: number, c1y: number, c2o: number, c2y: number, segs = 10, c?: Corner): this {
    const s = this.last;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, u = 1 - t;
      const node: PNode = {
        o: u * u * u * s.o + 3 * u * u * t * c1o + 3 * u * t * t * c2o + t * t * t * o,
        y: u * u * u * s.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
        curve: i < segs,
      };
      if (i === segs && c) node.c = c;
      this.nodes.push(node);
    }
    return this;
  }

  /**
   * Circular arc to (o, y). `bulge` is the sagitta as a fraction of the
   * chord: positive bulges out of the material (convex), negative into it.
   */
  arc(o: number, y: number, bulge: number, segs = 8, c?: Corner): this {
    const s = this.last;
    const mx = (s.o + o) / 2, my = (s.y + y) / 2;
    const cx = o - s.o, cy = y - s.y;
    const chord = Math.hypot(cx, cy);
    if (chord < 1e-9 || Math.abs(bulge) < 1e-6) return this.to(o, y, c);
    // right of travel = out of material
    const rx = cy / chord, ry = -cx / chord;
    const sag = bulge * chord;
    const half = chord / 2;
    const R = (half * half + sag * sag) / (2 * Math.abs(sag));
    const sgn = Math.sign(sag);
    // centre lies on the opposite side of the bulge
    const ccx = mx - rx * sgn * (R - Math.abs(sag)), ccy = my - ry * sgn * (R - Math.abs(sag));
    const a0 = Math.atan2(s.y - ccy, s.o - ccx);
    let a1 = Math.atan2(y - ccy, o - ccx);
    // choose the sweep that passes through the bulge point
    const px = mx + rx * sag, py = my + ry * sag;
    const ap = Math.atan2(py - ccy, px - ccx);
    const norm = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let d = norm(a1 - a0);
    if (!(norm(ap - a0) < d)) d = d - 2 * Math.PI;
    a1 = a0 + d;
    for (let i = 1; i <= segs; i++) {
      const a = a0 + (a1 - a0) * (i / segs);
      const node: PNode = { o: ccx + R * Math.cos(a), y: ccy + R * Math.sin(a), curve: i < segs };
      if (i === segs && c) node.c = c;
      this.nodes.push(node);
    }
    return this;
  }

  /** Close the profile into a loop (for a ring such as a washer or a torus). */
  close(): this {
    this.closed = true;
    return this;
  }

  /** Expand corners into samples with normals. */
  expand(opts: ExpandOptions = {}): PSample[] {
    return expandProfile(this.nodes, this.closed, opts);
  }
}

/** Start a profile at (o, y). */
export function profile(o: number, y: number): Profile {
  return new Profile(o, y);
}

interface ENode {
  o: number;
  y: number;
  n?: [number, number] | undefined;
  crease: boolean;
  /** Support distances requested on the segment before / after this node. */
  supBefore?: number;
  supAfter?: number;
}

function dedupeNodes(nodes: PNode[], closed: boolean): PNode[] {
  const out: PNode[] = [];
  for (const n of nodes) {
    const l = out[out.length - 1];
    if (l && Math.hypot(l.o - n.o, l.y - n.y) < 1e-9) {
      if (n.c) l.c = { ...l.c, ...n.c };
      continue;
    }
    out.push({ ...n });
  }
  if (closed && out.length > 2) {
    const f = out[0]!, l = out[out.length - 1]!;
    if (Math.hypot(l.o - f.o, l.y - f.y) < 1e-9) {
      if (l.c) f.c = { ...f.c, ...l.c };
      out.pop();
    }
  }
  return out;
}

/** Signed area of a polygon given as (o, y). Positive = counter-clockwise. */
function area2(pts: ReadonlyArray<{ o: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p.o * q.y - q.o * p.y;
  }
  return a / 2;
}

export function expandProfile(nodesIn: PNode[], closed: boolean, opts: ExpandOptions = {}): PSample[] {
  const nodes = dedupeNodes(nodesIn, closed);
  const N = nodes.length;
  if (N < 2) throw new Error('profile needs at least two points');
  const detail = opts.detail ?? 1;
  const maxSegs = opts.segs ?? 6;
  const band = opts.band ?? 0;
  const creaseCos = Math.cos(((opts.creaseDeg ?? DEFAULT_CREASE_DEG) * Math.PI) / 180);
  const sgn = area2(nodes) >= 0 ? 1 : -1;
  const segNormal = (a: { o: number; y: number }, b: { o: number; y: number }): [number, number] => {
    const dx = b.o - a.o, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return [(sgn * dy) / l, (-sgn * dx) / l];
  };
  const at = (i: number): PNode => nodes[((i % N) + N) % N]!;

  // 1. corners → emitted nodes
  const E: ENode[] = [];
  for (let i = 0; i < N; i++) {
    const P = nodes[i]!;
    const isEnd = !closed && (i === 0 || i === N - 1);
    if (isEnd || P.curve) {
      E.push({ o: P.o, y: P.y, crease: false, n: P.n });
      continue;
    }
    const A = at(i - 1), B = at(i + 1);
    const l0 = Math.hypot(P.o - A.o, P.y - A.y), l1 = Math.hypot(B.o - P.o, B.y - P.y);
    const d0: [number, number] = [(P.o - A.o) / l0, (P.y - A.y) / l0];
    const d1: [number, number] = [(B.o - P.o) / l1, (B.y - P.y) / l1];
    const cosT = d0[0] * d1[0] + d0[1] * d1[1];
    const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
    const c = P.c ?? {};
    const n0 = segNormal(A, P);
    // room on each side: the whole segment if the neighbour is an end or a curve sample, else half
    const roomA = A.curve || (!closed && i - 1 === 0) ? l0 * 0.999 : l0 * 0.5;
    const roomB = B.curve || (!closed && i + 1 === N - 1) ? l1 * 0.999 : l1 * 0.5;
    if (c.fillet && c.fillet > 0 && theta > 1e-3) {
      let t = c.fillet * Math.tan(theta / 2);
      t = Math.min(t, roomA, roomB);
      const rho = t / Math.tan(theta / 2);
      const a: [number, number] = [P.o - d0[0] * t, P.y - d0[1] * t];
      const b: [number, number] = [P.o + d1[0] * t, P.y + d1[1] * t];
      const cross = d0[0] * d1[1] - d0[1] * d1[0];
      const L: [number, number] = cross > 0 ? [-d0[1], d0[0]] : [d0[1], -d0[0]];
      const C: [number, number] = [a[0] + L[0] * rho, a[1] + L[1] * rho];
      const per90 = c.segs ?? autoSegs(rho, maxSegs);
      // at least two segments on a real turn, so the fillet has an interior vertex for the wear signal
      const segs = Math.max(theta > 1 && c.segs === undefined && rho >= 0.008 ? 2 : 1, Math.round((per90 * detail * theta) / (Math.PI / 2)));
      const aa = Math.atan2(a[1] - C[1], a[0] - C[0]);
      let ab = Math.atan2(b[1] - C[1], b[0] - C[0]);
      while (ab - aa > Math.PI) ab -= 2 * Math.PI;
      while (ab - aa < -Math.PI) ab += 2 * Math.PI;
      const nsgn = (Math.cos(aa) * n0[0] + Math.sin(aa) * n0[1]) >= 0 ? 1 : -1;
      const sup = band > 0 ? band : Math.max(0.004, Math.min(rho * 0.6, 0.02));
      for (let k = 0; k <= segs; k++) {
        const ang = aa + (ab - aa) * (k / segs);
        const node: ENode = {
          o: C[0] + Math.cos(ang) * rho,
          y: C[1] + Math.sin(ang) * rho,
          n: [nsgn * Math.cos(ang), nsgn * Math.sin(ang)],
          crease: false,
        };
        if (k === 0) node.supBefore = sup;
        if (k === segs) node.supAfter = sup;
        E.push(node);
      }
      continue;
    }
    if (c.chamfer && c.chamfer > 0 && theta > 1e-3) {
      const t = Math.min(c.chamfer, roomA, roomB);
      const sup = band > 0 ? band : Math.max(0.004, Math.min(t * 0.8, 0.012));
      E.push({ o: P.o - d0[0] * t, y: P.y - d0[1] * t, crease: true, supBefore: sup });
      E.push({ o: P.o + d1[0] * t, y: P.y + d1[1] * t, crease: true, supAfter: sup });
      continue;
    }
    const crease = c.sharp === true || (!c.smooth && cosT < creaseCos);
    E.push({ o: P.o, y: P.y, crease });
  }

  // 2. support samples on straight runs next to fillets and creases
  const S: ENode[] = [];
  const support = opts.support === true || band > 0;
  const M = E.length;
  const segCount = closed ? M : M - 1;
  for (let i = 0; i < M; i++) {
    const a = E[i]!;
    S.push(a);
    if (!support || i >= segCount) continue;
    const b = E[(i + 1) % M]!;
    const len = Math.hypot(b.o - a.o, b.y - a.y);
    if (len < 1e-9) continue;
    const dx = (b.o - a.o) / len, dy = (b.y - a.y) / len;
    // a run facing straight down (a box's base) is never seen: no band ring there
    if (band > 0 && segNormal(a, b)[1] < -0.9) continue;
    const sa = a.supAfter ?? 0, sb = b.supBefore ?? 0;
    if (sa > 0 && len > sa * 2.5 + sb) S.push({ o: a.o + dx * sa, y: a.y + dy * sa, crease: false, n: segNormal(a, b) });
    if (sb > 0 && len > sb * 2.5 + sa) S.push({ o: b.o - dx * sb, y: b.y - dy * sb, crease: false, n: segNormal(a, b) });
  }

  // 3. normals
  const out: PSample[] = [];
  const K = S.length;
  for (let i = 0; i < K; i++) {
    const p = S[i]!;
    const hasPrev = closed || i > 0, hasNext = closed || i < K - 1;
    const prev = S[(i - 1 + K) % K]!, next = S[(i + 1) % K]!;
    const nIn = hasPrev ? segNormal(prev, p) : null;
    const nOut = hasNext ? segNormal(p, next) : null;
    if (p.crease && nIn && nOut) {
      out.push({ o: p.o, y: p.y, no: nIn[0], ny: nIn[1] });
      out.push({ o: p.o, y: p.y, no: nOut[0], ny: nOut[1] });
      continue;
    }
    let n: [number, number];
    if (p.n) n = p.n;
    else if (nIn && nOut) n = [nIn[0] + nOut[0], nIn[1] + nOut[1]];
    else n = (nIn ?? nOut)!;
    const l = Math.hypot(n[0], n[1]) || 1;
    out.push({ o: p.o, y: p.y, no: n[0] / l, ny: n[1] / l });
  }
  return out;
}

// ---- loops -----------------------------------------------------------------

/** A ring of samples in the plane (x, z): core point p, offset direction m (mitred), shading normal n. */
export interface Loop {
  p: number[];
  m: number[];
  n: number[];
  closed: boolean;
}

function emptyLoop(closed: boolean): Loop {
  return { p: [], m: [], n: [], closed };
}

function pushS(l: Loop, px: number, pz: number, mx: number, mz: number, nx: number, nz: number): void {
  l.p.push(px, pz);
  l.m.push(mx, mz);
  const nl = Math.hypot(nx, nz) || 1;
  l.n.push(nx / nl, nz / nl);
}

export function loopLength(l: Loop): number {
  return l.p.length / 2;
}

/** A lathe's loop: the axis point, normals round a circle (or an arc from a0 to a1, open). */
export function circleLoop(segs: number, a0 = 0, a1 = Math.PI * 2): Loop {
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-9;
  const l = emptyLoop(full);
  const n = full ? segs : segs + 1;
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / segs;
    // angle measured so that +Z (toward the visitor) is a = π/2 when x=cos, z=sin
    const c = Math.cos(a), s = Math.sin(a);
    pushS(l, 0, 0, c, s, c, s);
  }
  return l;
}

/**
 * A rounded rectangle's core: four corner points at (±hx, ±hz) with m = n
 * sweeping 90° round each corner in `segs` steps. Offsetting by o gives a
 * rectangle of half-size (hx + o, hz + o) with corner radius o. Support
 * samples at distance `support` along each edge keep wear lines tight.
 */
export function rectLoop(hx: number, hz: number, segs: number, support = 0): Loop {
  const l = emptyLoop(true);
  const corners: Array<[number, number, number]> = [
    [hx, hz, 0],
    [-hx, hz, Math.PI / 2],
    [-hx, -hz, Math.PI],
    [hx, -hz, (3 * Math.PI) / 2],
  ];
  // corner k sweeps normals from angle a to a + π/2, starting from (1,0) at (hx,hz)
  for (let k = 0; k < 4; k++) {
    const [cx, cz, a] = corners[k]!;
    // support before this corner: along the previous edge, normal = start normal
    const n0x = Math.cos(a), n0z = Math.sin(a);
    if (support > 0) {
      // previous edge runs toward this corner in direction (−sin a·−1...) : the edge with normal n0 runs along tangent t = (-n0z, n0x)
      const tx = -n0z, tz = n0x;
      const edgeLen = k % 2 === 0 ? hz * 2 : hx * 2;
      if (edgeLen > support * 3) pushS(l, cx - tx * support, cz - tz * support, n0x, n0z, n0x, n0z);
    }
    for (let i = 0; i <= segs; i++) {
      const b = a + (Math.PI / 2) * (i / segs);
      pushS(l, cx, cz, Math.cos(b), Math.sin(b), Math.cos(b), Math.sin(b));
    }
    if (support > 0) {
      const b = a + Math.PI / 2;
      const nx = Math.cos(b), nz = Math.sin(b);
      const tx = -nz, tz = nx;
      const edgeLen = k % 2 === 0 ? hx * 2 : hz * 2;
      if (edgeLen > support * 3) pushS(l, cx + tx * support, cz + tz * support, nx, nz, nx, nz);
    }
  }
  return l;
}

/**
 * A crisp-chamfered rectangle core: like rectLoop but each corner is one
 * 45° facet with split normals.
 */
export function chamferRectLoop(hx: number, hz: number): Loop {
  const l = emptyLoop(true);
  const cs: Array<[number, number, number]> = [
    [hx, hz, 0],
    [-hx, hz, Math.PI / 2],
    [-hx, -hz, Math.PI],
    [hx, -hz, (3 * Math.PI) / 2],
  ];
  for (const [cx, cz, a] of cs) {
    const ax = Math.cos(a), az = Math.sin(a);
    const bx = Math.cos(a + Math.PI / 2), bz = Math.sin(a + Math.PI / 2);
    const hxm = Math.cos(a + Math.PI / 4), hzm = Math.sin(a + Math.PI / 4);
    pushS(l, cx, cz, ax, az, ax, az);
    pushS(l, cx, cz, ax, az, hxm, hzm);
    pushS(l, cx, cz, bx, bz, hxm, hzm);
    pushS(l, cx, cz, bx, bz, bx, bz);
  }
  return l;
}

export interface OutlineOptions {
  /** Corner radius: one for all corners, or one per input point. 0 = sharp (creased). */
  radius?: number | number[];
  /** Most segments per 90° of corner (each corner gets 1 + 45·r of them, up to this). */
  segs?: number;
  /** This loop is a hole (its normals face into the hole). */
  hole?: boolean;
  /** Support distance next to rounded corners. */
  support?: number;
}

/**
 * A loop from a 2D outline [x, z][] with each corner rounded. Offsets are
 * mitred so an inward bevel keeps the outline's shape. For a clean bevel,
 * convex corner radii should be at least the bevel size.
 */
export function outlineLoop(points: ReadonlyArray<readonly [number, number]>, opts: OutlineOptions = {}): Loop {
  let pts = points.map((p) => [p[0], p[1]] as [number, number]);
  // orientation: outer CCW, hole CW (in x,z with signed area x*z' - x'*z)
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  let radii = Array.isArray(opts.radius) ? opts.radius.slice() : pts.map(() => (opts.radius as number | undefined) ?? 0);
  if ((a < 0) !== !!opts.hole) {
    pts = pts.reverse();
    radii = radii.reverse();
  }
  const segs = opts.segs ?? 4;
  const sup = opts.support ?? 0;
  // build the rounded polyline, tagging crease corners
  type V = { x: number; z: number; crease: boolean; n?: [number, number]; sup?: 'before' | 'after' };
  const V: V[] = [];
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const P = pts[i]!, A = pts[(i - 1 + N) % N]!, B = pts[(i + 1) % N]!;
    const r = radii[i] ?? 0;
    const l0 = Math.hypot(P[0] - A[0], P[1] - A[1]), l1 = Math.hypot(B[0] - P[0], B[1] - P[1]);
    const d0 = [(P[0] - A[0]) / l0, (P[1] - A[1]) / l0] as const;
    const d1 = [(B[0] - P[0]) / l1, (B[1] - P[1]) / l1] as const;
    const cosT = d0[0] * d1[0] + d0[1] * d1[1];
    const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
    if (r <= 0 || theta < 1e-3) {
      V.push({ x: P[0], z: P[1], crease: theta > 0.6 });
      continue;
    }
    let t = r * Math.tan(theta / 2);
    t = Math.min(t, l0 * 0.5, l1 * 0.5);
    const rho = t / Math.tan(theta / 2);
    const ax = P[0] - d0[0] * t, az = P[1] - d0[1] * t;
    const cross = d0[0] * d1[1] - d0[1] * d1[0];
    const L = cross > 0 ? [-d0[1], d0[0]] : [d0[1], -d0[0]];
    const cx = ax + L[0]! * rho, cz = az + L[1]! * rho;
    const n = Math.max(1, Math.round((Math.min(segs, autoSegs(rho, segs)) * theta) / (Math.PI / 2)));
    const a0 = Math.atan2(az - cz, ax - cx);
    let a1 = Math.atan2(P[1] + d1[1] * t - cz, P[0] + d1[0] * t - cx);
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
    for (let k = 0; k <= n; k++) {
      const ang = a0 + (a1 - a0) * (k / n);
      const v: V = { x: cx + Math.cos(ang) * rho, z: cz + Math.sin(ang) * rho, crease: false };
      if (k === 0 && sup > 0) v.sup = 'before';
      if (k === n && sup > 0) v.sup = 'after';
      V.push(v);
    }
  }
  // insert supports
  const W: V[] = [];
  for (let i = 0; i < V.length; i++) {
    const v = V[i]!, w = V[(i + 1) % V.length]!;
    W.push(v);
    const len = Math.hypot(w.x - v.x, w.z - v.z);
    if (sup > 0 && len > sup * 3) {
      const dx = (w.x - v.x) / len, dz = (w.z - v.z) / len;
      if (v.sup === 'after') W.push({ x: v.x + dx * sup, z: v.z + dz * sup, crease: false });
      if (w.sup === 'before') W.push({ x: w.x - dx * sup, z: w.z - dz * sup, crease: false });
    }
  }
  // normals: outward = right of travel for CCW (x,z): (dz, -dx)
  const l = emptyLoop(true);
  const M = W.length;
  const en = (p: V, q: V): [number, number] => {
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    return [dz / len, -dx / len];
  };
  for (let i = 0; i < M; i++) {
    const p = W[i]!, prev = W[(i - 1 + M) % M]!, next = W[(i + 1) % M]!;
    const nIn = en(prev, p), nOut = en(p, next);
    let mx = nIn[0] + nOut[0], mz = nIn[1] + nOut[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cosHalf = Math.max(0.25, mx * nIn[0] + mz * nIn[1]);
    const mmx = mx / cosHalf, mmz = mz / cosHalf;
    if (p.crease) {
      pushS(l, p.x, p.z, mmx, mmz, nIn[0], nIn[1]);
      pushS(l, p.x, p.z, mmx, mmz, nOut[0], nOut[1]);
    } else {
      pushS(l, p.x, p.z, mmx, mmz, mx, mz);
    }
  }
  return l;
}

/** A regular polygon outline (e.g. a hex nut), points [x,z]; the first vertex at angle `phase`. */
export function ngon(sides: number, radius: number, phase = 0): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    out.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return out;
}

/** A superellipse outline |x/a|^e + |z/b|^e = 1 as a smooth loop around the origin (core = outline, m = n). */
export function superellipseLoop(a: number, b: number, e: number, segs: number): Loop {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([a * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / e)]);
  }
  return outlineLoop(pts, { radius: 0 });
}
