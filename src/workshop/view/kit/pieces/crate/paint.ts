/**
 * Paint and label tape on a realized crate, without a rebuild (REWRITE.md
 * § B1 "colour", "label"; brief W5).
 *
 * Paint and stencil state is keyed by a Piece's PART geometry. A realised crate
 * may draw that geometry as it is (the per-node backend) or merged with others
 * into one skinned mesh per material (the default backend); `sourcesOf(mesh)`
 * says where each part's vertices sit either way, and every write takes that
 * offset. Geometry shared with other crates (the build memo, the skinned
 * backend's per-Piece geometry) is cloned for the object on its first write,
 * so its twins never change.
 *
 * THE WIPE. `paintCrate(object, { from, to, t, axis })` shows the crate part
 * way through a change of paint: everything on the near side of an edge that
 * travels along `axis` (piece space, unit) is `to`, everything beyond it
 * `from`; t = 0 is all `from`, t = 1 all `to`. The edge is a little uneven
 * (seeded). It costs no triangle and no draw call: each plank's paint skin is
 * a fan a hair over its face, and the wipe moves the skin's vertices back to
 * the edge (the skin grows across the plank as the edge passes, with its
 * ragged rim); the paint being replaced is carried meanwhile by the plank's
 * own flat face (its four face vertices), which is bare wood again at rest.
 * Undo is the same call with t run backwards.
 *
 * THE TAPE. A crate built with `tape` carries a strip of label tape on its
 * front panel under the top rail: node `tape` (pivot at its left end), one
 * textured quad on the labels' atlas next to the stencils (so it merges into
 * their mesh). `crateTape(object, length)` lays it on from the left (0 none,
 * hidden at scale 1e-4, the house rule; 1 its whole length) by moving the
 * quad's right edge and its texture coordinates together, so the words are
 * uncovered, never squeezed.
 */
import { Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type Mesh, type Object3D } from 'three';
import { linear, type Token } from '../../../palette.ts';
import { sourcesOf } from '../../realize.ts';

/** The two stencil inks: `ink` on bare wood and light paints, `paper` on dark ones. */
export type StencilInk = 'ink' | 'paper';
const DARK_PAINTS: ReadonlySet<Token> = new Set<Token>(['cable-red', 'paint-blue', 'paint-violet', 'paint-green']);

/** Which stencil ink a crate of this paint wears. */
export function stencilInk(paint: Token | null): StencilInk {
  return paint && DARK_PAINTS.has(paint) ? 'paper' : 'ink';
}

export interface PaintInfo {
  /** [first vertex, count] of every paint skin in the part's geometry. */
  ranges: Array<[number, number]>;
  /** Per skin vertex (in range order): the bare colour (rgb) and the paint's tone multiplier. */
  bare: Float32Array;
  tone: Float32Array;
  /** The planks' flat face vertices under the skins (part geometry indices), their bare colours and tones: they carry the paint being replaced during a wipe. */
  under: Int32Array;
  underBare: Float32Array;
  underTone: Float32Array;
}

/** A stencil decal part: its ink, and its resting (showing) positions and normals in the part's own space. */
export interface StencilInfo {
  ink: StencilInk;
  rest: Float32Array;
  normal: Float32Array;
}

/** The tape quad: its right-end vertices, each paired with the left-end vertex on the same edge of the strip (part geometry indices). */
export interface TapeInfo {
  pairs: Array<[left: number, right: number]>;
}

export const PAINT = new WeakMap<BufferGeometry, PaintInfo>();
export const STENCIL = new WeakMap<BufferGeometry, StencilInfo>();
export const TAPE = new WeakMap<BufferGeometry, TapeInfo>();

/** surf.z written on painted skins: paint coverage for the `wood` class (0 bare .. 1 fully painted). */
const PAINT_COVERAGE = 1;
/** How far the unused stencil sinks behind the face (decals sit 0.0042 proud; planks are at least 0.024 thick). */
const STENCIL_SINK = 0.016;
/** Scale of a hidden node (the house rule). */
export const HIDDEN = 1e-4;
/** The wipe's edge: how uneven it is (units), and the default axis (from the top at the back, down the front). */
export const WIPE = { rag: 0.022, axis: [0, -0.83, 0.56] as readonly [number, number, number] };

/**
 * Write paint (or bare wood) into `g`, whose vertices from `at` on are this part's
 * (0 for the part's own geometry). Colour and coverage only: positions untouched.
 * Returns the vertices written.
 */
export function writePaint(g: BufferGeometry, info: PaintInfo, paint: Token | null, at = 0): number {
  const col = g.getAttribute('color') as BufferAttribute;
  const sf = g.getAttribute('surf') as BufferAttribute;
  const a = col.array as Float32Array;
  const pc = paint ? linear(paint) : null;
  let k = 0;
  for (const [start, count] of info.ranges) {
    for (let i = at + start; i < at + start + count; i++, k++) {
      if (pc) {
        const t = info.tone[k]!;
        a[i * 3] = pc[0] * t;
        a[i * 3 + 1] = pc[1] * t;
        a[i * 3 + 2] = pc[2] * t;
      } else {
        a[i * 3] = info.bare[k * 3]!;
        a[i * 3 + 1] = info.bare[k * 3 + 1]!;
        a[i * 3 + 2] = info.bare[k * 3 + 2]!;
      }
      sf.setZ(i, paint ? PAINT_COVERAGE : 0);
    }
  }
  col.needsUpdate = true;
  sf.needsUpdate = true;
  return k;
}

/** The planks' flat faces: `paint` (the paint a wipe is replacing) or bare wood. */
function writeUnder(g: BufferGeometry, info: PaintInfo, paint: Token | null, at = 0): void {
  if (info.under.length === 0) return;
  const col = g.getAttribute('color') as BufferAttribute;
  const sf = g.getAttribute('surf') as BufferAttribute;
  const a = col.array as Float32Array;
  const pc = paint ? linear(paint) : null;
  for (let k = 0; k < info.under.length; k++) {
    const i = at + info.under[k]!;
    if (pc) {
      const t = info.underTone[k]!;
      a[i * 3] = pc[0] * t;
      a[i * 3 + 1] = pc[1] * t;
      a[i * 3 + 2] = pc[2] * t;
    } else {
      a[i * 3] = info.underBare[k * 3]!;
      a[i * 3 + 1] = info.underBare[k * 3 + 1]!;
      a[i * 3 + 2] = info.underBare[k * 3 + 2]!;
    }
    sf.setZ(i, paint ? PAINT_COVERAGE : 0);
  }
  col.needsUpdate = true;
  sf.needsUpdate = true;
}

const vS = new Vector3();

/**
 * Show or sink a stencil part inside `g` (its vertices from `at` on). `world` takes the
 * part's own space to `g`'s space: identity for the part's own geometry, the node's rest
 * world matrix inside a skinned mesh. Returns the vertices written.
 */
export function writeStencil(g: BufferGeometry, info: StencilInfo, ink: StencilInk, at = 0, world?: Matrix4): number {
  const pos = g.getAttribute('position') as BufferAttribute;
  const p = pos.array as Float32Array;
  const sink = info.ink === ink ? 0 : STENCIL_SINK;
  const n = info.rest.length / 3;
  for (let i = 0; i < n; i++) {
    vS.set(info.rest[i * 3]! - info.normal[i * 3]! * sink, info.rest[i * 3 + 1]! - info.normal[i * 3 + 1]! * sink, info.rest[i * 3 + 2]! - info.normal[i * 3 + 2]! * sink);
    if (world) vS.applyMatrix4(world);
    p[(at + i) * 3] = vS.x;
    p[(at + i) * 3 + 1] = vS.y;
    p[(at + i) * 3 + 2] = vS.z;
  }
  pos.needsUpdate = true;
  return n;
}

// ---- the realized crate's own copy ----------------------------------------------------

interface Item {
  start: number;
  node: string;
  paint?: PaintInfo;
  stencil?: StencilInfo;
  tape?: TapeInfo;
  /** Stencil: its showing positions and normals in the mesh's space, its centroid in piece space. */
  meshStencil?: { rest: Float32Array; normal: Float32Array };
  centroid?: Vector3;
  /** Paint: the skins' rest positions (mesh space, range order). */
  rest?: Float32Array;
  /** Tape: per pair, the rest position and uvs of its left and its right vertex (left first). */
  tapeRest?: { pos: Float32Array; uv: Float32Array | null; uv1: Float32Array | null };
}

interface Own {
  items: Item[];
  /** Mesh space to piece space (identity on the skinned backend), and its inverse. */
  toPiece: Matrix4 | null;
  fromPiece: Matrix4 | null;
}

const OWN = new WeakMap<Mesh, Own>();

/** This crate's own copy of a mesh's geometry and where its paint, stencil and tape sit in it (made on first touch). */
function own(object: Object3D, m: Mesh): Own | null {
  const had = OWN.get(m);
  if (had) return had;
  const sources = sourcesOf(m).filter((s) => PAINT.has(s.source) || STENCIL.has(s.source) || TAPE.has(s.source));
  if (sources.length === 0) return null;
  const g = m.geometry.clone();
  g.userData = { ...m.geometry.userData };
  m.geometry = g;
  // a per-node clone is not the Piece's geometry: remember where the crate's parts sit (readers of the mesh use it)
  m.userData['crateOwnPaint'] = sources;
  const skinned = (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh === true;
  let toPiece: Matrix4 | null = null;
  if (!skinned) {
    object.updateWorldMatrix(true, true);
    toPiece = object.matrixWorld.clone().invert().multiply(m.matrixWorld);
  }
  const pos = g.getAttribute('position') as BufferAttribute;
  const uv = g.getAttribute('uv') as BufferAttribute | undefined;
  const uv1 = g.getAttribute('uv1') as BufferAttribute | undefined;
  const items: Item[] = sources.map((s) => {
    const it: Item = { start: s.start, node: s.node };
    const paint = PAINT.get(s.source);
    if (paint) {
      it.paint = paint;
      const n = paint.ranges.reduce((k, r) => k + r[1], 0);
      const rest = new Float32Array(n * 3);
      let k = 0;
      for (const [a, c] of paint.ranges) for (let i = s.start + a; i < s.start + a + c; i++, k++) rest.set([pos.getX(i), pos.getY(i), pos.getZ(i)], k * 3);
      it.rest = rest;
    }
    const st = STENCIL.get(s.source);
    if (st) {
      it.stencil = st;
      // its showing place in this mesh's own space: where it sits now, lifted back out if it was built sunk
      // (read from the mesh, so no bind matrices are needed whatever the mesh's space is)
      const src = s.source.getAttribute('position');
      const sunk = Math.abs(src.getX(0) - st.rest[0]!) + Math.abs(src.getY(0) - st.rest[1]!) + Math.abs(src.getZ(0) - st.rest[2]!) > 1e-6;
      const nm = g.getAttribute('normal') as BufferAttribute;
      const n = st.rest.length / 3;
      const mr = new Float32Array(n * 3), mn = new Float32Array(n * 3);
      const c = new Vector3();
      for (let i = 0; i < n; i++) {
        const v = s.start + i;
        vS.set(nm.getX(v), nm.getY(v), nm.getZ(v)).normalize();
        mn.set([vS.x, vS.y, vS.z], i * 3);
        const k = sunk ? STENCIL_SINK : 0;
        mr.set([pos.getX(v) + vS.x * k, pos.getY(v) + vS.y * k, pos.getZ(v) + vS.z * k], i * 3);
        c.x += mr[i * 3]!;
        c.y += mr[i * 3 + 1]!;
        c.z += mr[i * 3 + 2]!;
      }
      c.multiplyScalar(1 / Math.max(1, n));
      if (toPiece) c.applyMatrix4(toPiece);
      it.centroid = c;
      it.meshStencil = { rest: mr, normal: mn };
    }
    const tp = TAPE.get(s.source);
    if (tp) {
      it.tape = tp;
      const ids = tp.pairs.flat();
      const p4 = new Float32Array(ids.length * 3);
      const u4 = uv ? new Float32Array(ids.length * 2) : null;
      const w4 = uv1 ? new Float32Array(ids.length * 2) : null;
      ids.forEach((v, k) => {
        const i = s.start + v;
        p4.set([pos.getX(i), pos.getY(i), pos.getZ(i)], k * 3);
        if (u4 && uv) u4.set([uv.getX(i), uv.getY(i)], k * 2);
        if (w4 && uv1) w4.set([uv1.getX(i), uv1.getY(i)], k * 2);
      });
      it.tapeRest = { pos: p4, uv: u4, uv1: w4 };
    }
    return it;
  });
  const o: Own = { items, toPiece, fromPiece: toPiece ? toPiece.clone().invert() : null };
  OWN.set(m, o);
  return o;
}

function meshes(object: Object3D): Array<{ m: Mesh; o: Own }> {
  const out: Array<{ m: Mesh; o: Own }> = [];
  object.traverse((x) => {
    const m = x as Mesh;
    if (!m.isMesh) return;
    const o = own(object, m);
    if (o) out.push({ m, o });
  });
  return out;
}

// ---- paint ------------------------------------------------------------------------------

/** A crate's paint as drawn: `from` replaced by `to` up to an edge `t` of the way along `axis` (piece space). */
export interface CrateLook {
  from: Token | null;
  to: Token | null;
  /** 0 all `from` .. 1 all `to`. */
  t: number;
  /** The way the edge travels, piece space (normalised here). Default WIPE.axis. */
  axis?: readonly [number, number, number];
  /** Seeds the edge's unevenness. */
  seed?: number;
}

const vA = new Vector3();
const vP = new Vector3();
const vN = new Vector3();
const vIn = new Vector3();

/** The edge's unevenness at a piece-space point: a few incommensurate ripples (seeded), ± WIPE.rag. */
function rag(x: number, y: number, z: number, s: number): number {
  return WIPE.rag * (0.5 * Math.sin(x * 41 + y * 7 + s) + 0.3 * Math.sin(y * 29 + z * 37 + s * 1.7) + 0.2 * Math.sin((x - z) * 97 + s * 2.3));
}

/**
 * Draw a crate's paint part way through a change (see the file note). Rewrites the paint
 * skins' colour, coverage and (mid-wipe) positions, the planks' faces under them, and
 * which stencil ink shows. Returns the paint and stencil vertices written (0: not a crate).
 */
export function paintCrate(object: Object3D, look: CrateLook): number {
  const list = meshes(object);
  if (list.length === 0) return 0;
  const t = Math.max(0, Math.min(1, look.t));
  const ax = look.axis ?? WIPE.axis;
  vA.set(ax[0], ax[1], ax[2]).normalize();
  const seed = ((look.seed ?? 1) % 997) * 0.731;
  const settled = t >= 1 || t <= 0 || look.from === look.to;
  const showing = t <= 0 ? look.from : look.to;
  // the edge runs over the skins' extent along the axis, from a rag's width before it to a rag's width past it
  let lo = Infinity, hi = -Infinity;
  if (!settled) {
    for (const { o } of list) for (const it of o.items) {
      if (!it.rest) continue;
      for (let k = 0; k < it.rest.length; k += 3) {
        vP.set(it.rest[k]!, it.rest[k + 1]!, it.rest[k + 2]!);
        if (o.toPiece) vP.applyMatrix4(o.toPiece);
        const d = vP.dot(vA);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
  }
  const edge = lo - WIPE.rag * 1.2 + (hi - lo + WIPE.rag * 2.4) * t;
  // the skin carries the paint that is arriving; or, when bare wood is arriving, the paint going
  const skinPaint = settled ? showing : look.to ?? look.from;
  const keepNear = settled || look.to !== null;
  const underPaint = settled || look.to === null ? null : look.from;
  /** Which paint shows at a piece-space point mid-wipe. */
  const at = (p: Vector3): Token | null => (settled ? showing : p.dot(vA) <= edge - rag(p.x, p.y, p.z, seed) ? look.to : look.from);
  let n = 0;
  for (const { m, o } of list) {
    const g = m.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    let moved = false;
    for (const it of o.items) {
      if (it.paint) {
        n += writePaint(g, it.paint, skinPaint, it.start);
        writeUnder(g, it.paint, underPaint, it.start);
        // the skins' extent: at rest everywhere; mid-wipe each vertex past the edge is drawn back onto it
        const rest = it.rest!;
        let k = 0;
        const nrm = g.getAttribute('normal') as BufferAttribute;
        for (const [a, c] of it.paint.ranges) {
          // a skin is a flat fan (its first vertex the centre): it is drawn back across its own plane, along the
          // axis's share in that plane, so it stays on the plank; a face square to the axis is all or nothing
          const k0 = k;
          if (!settled) {
            vN.set(nrm.getX(it.start + a), nrm.getY(it.start + a), nrm.getZ(it.start + a));
            if (o.toPiece) vN.transformDirection(o.toPiece);
            vIn.copy(vA).addScaledVector(vN, -vA.dot(vN));
          }
          const len = settled ? 0 : vIn.length();
          if (len > 1e-6) vIn.multiplyScalar(1 / len);
          for (let i = it.start + a; i < it.start + a + c; i++, k++) {
            let x = rest[k * 3]!, y = rest[k * 3 + 1]!, z = rest[k * 3 + 2]!;
            if (!settled) {
              vP.set(x, y, z);
              if (o.toPiece) vP.applyMatrix4(o.toPiece);
              const b = edge - rag(vP.x, vP.y, vP.z, seed);
              const d = vP.dot(vA);
              const over = keepNear ? d - b : b - d;
              if (over > 0) {
                if (len < 0.2) {
                  // square to the axis: drawn to nothing at the fan's centre
                  x = rest[k0 * 3]!;
                  y = rest[k0 * 3 + 1]!;
                  z = rest[k0 * 3 + 2]!;
                } else {
                  vP.addScaledVector(vIn, ((keepNear ? -1 : 1) * over) / len);
                  if (o.fromPiece) vP.applyMatrix4(o.fromPiece);
                  x = vP.x;
                  y = vP.y;
                  z = vP.z;
                }
              }
            }
            pos.setXYZ(i, x, y, z);
          }
        }
        moved = true;
      }
      if (it.stencil) {
        n += writeStencil(g, { ink: it.stencil.ink, ...it.meshStencil! }, stencilInk(at(it.centroid!)), it.start);
        moved = true;
      }
    }
    if (moved) pos.needsUpdate = true;
  }
  return n;
}

/**
 * Repaint a realized crate (the Object3D from `realize`, either backend) at once: the paint
 * skins' colour and coverage to `paint` (a palette token) or back to bare wood (null), and
 * the stencil ink that paint wants. Returns how many vertices it wrote (0: not a crate).
 */
export function repaint(object: Object3D, paint: Token | null): number {
  return paintCrate(object, { from: paint, to: paint, t: 1 });
}

// ---- the tape ------------------------------------------------------------------------------

/**
 * Lay a crate's label tape on to `length` (0 none: the node hidden; 1 the quad's whole
 * width). Returns false when the crate has no tape.
 */
export function crateTape(object: Object3D, length: number): boolean {
  const L = Math.max(0, Math.min(1, length));
  let node: Object3D | undefined;
  object.traverse((x) => {
    if (!node && x.name === 'tape' && !(x as Mesh).isMesh) node = x;
  });
  if (!node) return false;
  node.scale.setScalar(L > 0 ? 1 : HIDDEN);
  if (L <= 0) return true;
  for (const { m, o } of meshes(object)) {
    const g = m.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const uv = g.getAttribute('uv') as BufferAttribute | undefined;
    const uv1 = g.getAttribute('uv1') as BufferAttribute | undefined;
    for (const it of o.items) {
      if (!it.tape || !it.tapeRest) continue;
      const r = it.tapeRest;
      // each right vertex slides along its edge of the strip from its left partner to its rest
      for (let k = 0; k < it.tape.pairs.length; k++) {
        const i = it.start + it.tape.pairs[k]![1];
        const l = 2 * k, rr = 2 * k + 1;
        const lerp = (arr: Float32Array, stride: number, c: number): number => arr[l * stride + c]! + (arr[rr * stride + c]! - arr[l * stride + c]!) * L;
        pos.setXYZ(i, lerp(r.pos, 3, 0), lerp(r.pos, 3, 1), lerp(r.pos, 3, 2));
        if (uv && r.uv) uv.setXY(i, lerp(r.uv, 2, 0), lerp(r.uv, 2, 1));
        if (uv1 && r.uv1) uv1.setXY(i, lerp(r.uv1, 2, 0), lerp(r.uv1, 2, 1));
      }
      pos.needsUpdate = true;
      if (uv) uv.needsUpdate = true;
      if (uv1) uv1.needsUpdate = true;
    }
  }
  return true;
}

// ---- reading back what is drawn (tests, review pages) -------------------------------------------

/**
 * What a realized crate shows: its skins' paint (a token, null for bare, 'mixed' mid-wipe or when
 * the skins disagree) and its tape's laid length (null: no tape; 0 hidden).
 */
export function crateLook(object: Object3D, tokens: readonly Token[]): { paint: Token | null | 'mixed'; tape: number | null } {
  let paint: Token | null | 'mixed' | undefined;
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-4;
  let tape: number | null = null;
  object.traverse((x) => {
    const m = x as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    for (const s of sourcesOf(m)) {
      const info = PAINT.get(s.source);
      if (info) {
        const col = g.getAttribute('color') as BufferAttribute;
        const sf = g.getAttribute('surf') as BufferAttribute;
        const rest = OWN.get(m)?.items.find((it) => it.start === s.start)?.rest;
        let k = 0;
        for (const [a, c] of info.ranges) for (let i = s.start + a; i < s.start + a + c; i++, k++) {
          let here: Token | null | 'mixed' = 'mixed';
          if (sf.getZ(i) === 0 && near(col.getX(i), info.bare[k * 3]!) && near(col.getY(i), info.bare[k * 3 + 1]!)) here = null;
          else {
            const tone = info.tone[k]!;
            for (const tk of tokens) {
              const c3 = linear(tk);
              if (near(col.getX(i), c3[0] * tone) && near(col.getY(i), c3[1] * tone) && near(col.getZ(i), c3[2] * tone)) here = tk;
            }
          }
          // a skin drawn back off its rest is mid-wipe
          if (rest && (!near((g.getAttribute('position') as BufferAttribute).getX(i), rest[k * 3]!) || !near((g.getAttribute('position') as BufferAttribute).getY(i), rest[k * 3 + 1]!))) here = 'mixed';
          paint = paint === undefined ? here : paint === here ? paint : 'mixed';
        }
      }
      const tp = TAPE.get(s.source);
      if (tp) {
        // the tape node is hidden by scale; laid, its length is where its right edge is
        let hidden = false;
        object.traverse((y) => {
          if (y.name === 'tape' && !(y as Mesh).isMesh) hidden = y.scale.x < 1e-3;
        });
        const pos = g.getAttribute('position') as BufferAttribute;
        const r = OWN.get(m)?.items.find((it) => it.tape)?.tapeRest;
        if (hidden) tape = 0;
        else if (!r) tape = 1;
        else {
          const i = s.start + tp.pairs[0]![1];
          const fx = r.pos[3]! - r.pos[0]!, fy = r.pos[4]! - r.pos[1]!, fz = r.pos[5]! - r.pos[2]!;
          const ff = fx * fx + fy * fy + fz * fz;
          tape = ff < 1e-12 ? 1 : ((pos.getX(i) - r.pos[0]!) * fx + (pos.getY(i) - r.pos[1]!) * fy + (pos.getZ(i) - r.pos[2]!) * fz) / ff;
        }
      }
    }
  });
  // positions are float32: a whole strip reads 0.99998
  return { paint: paint ?? null, tape: tape === null ? null : Math.round(tape * 1e3) / 1e3 };
}
