/**
 * Pitch, drawn (P4 P1a; sim/crew/pitch.ts): C1's rig (kit/pieces/pitch: the chairman, take C, charcoal, the white
 * handlebar, the cane) driven from his simulation state. Nothing here changes the simulation.
 *
 *   where     his middle from `PitchView.at` (between the last two steps; a cut when the step says so), his nose
 *             from `heading`; the figure's attitude is this view's own, never his body's turning in the engine:
 *             nose up as he climbs, down as he sinks, a bank into his turns, a swing under the hand;
 *   alive     the envelope's slow breathing and a bob while he floats; the propeller turning by his speed, ticking
 *             over at the mast; the tie a beat late on every change of speed (none of it with reduced motion);
 *   his face  affront when the hand takes him, composure after; ruffled when loose, and his hat set straight again
 *             on his way home; heavy-lidded on the tray; turned to the visitor and his tie adjusted when poked; his
 *             hat raised as a tell; a startled look, then a disapproving one, while a Button rung plays;
 *   paint     the platen paints his cloth (kit/pieces/pitch/paint.ts), with the platen's wipe as it works;
 *   light     his two running lamps and his eye glow through the tells' halo mesh (`userData.halos`: tells.ts);
 *   shadow    he casts none of the key light's (he flies: it would land far off on the wall); a soft blob under him
 *             on whatever is below says how high he is.
 */
import { Box3, Group, Vector3, type PerspectiveCamera } from 'three';
import type { Id, PitchView, Vec3, WorldView } from '../../sim/types.ts';
import type { Frame, StationView, StationViewFactory, ViewContext } from '../types.ts';
import { pitch as pitchPiece, pivotsOf, posePitch, NEUTRAL, RIG, type PitchPose } from '../kit/pieces/pitch/index.ts';
import { paintPitch } from '../kit/pieces/pitch/paint.ts';
import { BlobShadows } from '../effects/blob-shadows.ts';
import { partsHooks, partShows, paintToken, type PartWork } from './parts.ts';
import type { Token } from '../palette.ts';

/** Tune here: degrees, units, seconds. */
export const PITCH_LOOK = {
  /** Nose up per unit/s climbing, and the most. */
  climbPitch: 5,
  pitchMost: 12,
  /** Bank per (rad/s of turn × unit/s of speed), and the most. */
  bank: 5,
  bankMost: 14,
  /** The swing under the hand: degrees per unit/s² of the hand's pull, and the most. */
  swing: 1.6,
  swingMost: 18,
  /** How quickly his attitude follows (1/s). */
  follow: 4,
  /** The bob and the breathing. */
  bob: 0.022,
  bobRate: 1.1,
  breathe: 0.007,
  breatheRate: 0.75,
  /** The propeller: degrees a second ticking over moored, and per unit/s of speed. */
  propIdle: 50,
  propPer: 620,
  /** The tie's swing per unit/s² of his change of speed (degrees), and how it settles. */
  tie: 2.2,
  tieMost: 22,
  /** The blob: its radius at the bench (units) and its growth and fading with height. */
  blobR: 0.62,
  blobGrow: 0.09,
  blobStrength: 0.85,
  blobFade: 0.16,
} as const;

const DEG = 180 / Math.PI;
const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number): number => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export interface PitchViewOptions {
  /** The crew's drawing scale (the kit's units are Fetch's body height). */
  readonly scale: number;
  readonly seed?: number;
}

function pitchOf(w: WorldView): PitchView | null {
  for (const c of w.crewViews()) if (c.kind === 'pitch') return c.view;
  return null;
}

export function createPitchView(o: PitchViewOptions): StationViewFactory {
  return (ctx: ViewContext): StationView => {
    const S = o.scale;
    const L = PITCH_LOOK;
    const root = new Group();
    root.name = 'pitch';
    const piece = pitchPiece({ take: 'C', cloth: 'charcoal', hook: 'cane', moustache: 'handlebar', seed: o.seed ?? 3, detail: ctx.tier === 'low' ? 'low' : 'high' });
    const obj = ctx.realize(piece, { castShadow: false });
    obj.scale.setScalar(S);
    root.add(obj);
    ctx.scene.add(root);
    const pv = pivotsOf('C', 'cane');
    const floatNode = obj.getObjectByName('float') ?? null;
    const eyeNode = obj.getObjectByName('eye') ?? null;
    // the hand takes him by his envelope (the box round it in the piece's own frame)
    const f0 = NEUTRAL.float;
    ctx.pickable('pitch', obj, { box: new Box3(new Vector3(-0.36, f0 - 0.5, -0.66), new Vector3(0.36, f0 + 0.42, 0.42)) });
    const shadows = new BlobShadows(ctx.materials.decal(), 1, 0.55).addTo(root);
    const camera = (ctx.stage.camera as unknown as { camera: PerspectiveCamera }).camera;
    const cam = new Vector3();
    const v3 = new Vector3();
    const c3 = new Vector3();

    // ── the view's own state ──
    const att = { pitch: 0, roll: 0, tie: [0, 0] as [number, number], tieV: [0, 0] as [number, number], prop: 0, look: [0, 0] as [number, number] };
    let lastStep = -1;
    let hPrev = 0;
    let hNow = 0;
    let velPrev: Vec3 = [0, 0, 0];
    let acc: Vec3 = [0, 0, 0];
    let tellAt = -Infinity;
    let misfireAt = -Infinity;
    let rungAt = -Infinity;
    let wasBracketed = false;
    let lampLevel = 0.55;
    // paint
    const hooks = partsHooks(ctx.scene);
    const work: PartWork = { paint: null, label: null };
    const drawn = { from: 'bare', to: 'bare', t: 1, settled: true };
    const enamel = (c: string): Token | null => (c === 'bare' ? null : paintToken(c));

    /** The top of whatever is under (x, z) below `y`: the bench, a fixed body, a loose part. */
    const groundUnder = (w: WorldView, x: number, z: number, y: number, self: Id): number => {
      let g = w.scene.bench.top;
      for (const s of w.scene.statics) {
        if (s.shape.type !== 'box') continue;
        const h = s.shape.half;
        const c = s.pose.p;
        // (turned bodies by the round of their footprint: a shadow is soft)
        const r = Math.hypot(h[0], h[2]);
        const turned = Math.abs(s.pose.q[1]) > 1e-3;
        const inside = turned ? Math.hypot(x - c[0], z - c[2]) < r * 0.8 : Math.abs(x - c[0]) <= h[0] && Math.abs(z - c[2]) <= h[2];
        const t = c[1] + h[1];
        if (inside && t < y && t > g && t < 9) g = t;
      }
      for (const p of w.parts()) {
        if (p.id === self) continue;
        const m = w.motion(p.id);
        const h = w.halfExtents(p.id);
        if (!m || !h || m.mode === 'gone' || m.mode === 'chute') continue;
        if (Math.abs(x - m.pose.p[0]) > h[0] || Math.abs(z - m.pose.p[2]) > h[2]) continue;
        const t = m.pose.p[1] + h[1];
        if (t < y && t > g) g = t;
      }
      return g;
    };

    root.userData['halos'] = (add: (p: Vector3, r: number, minPx: number, level: number) => void): void => {
      if (!floatNode || !root.visible) return;
      floatNode.updateWorldMatrix(true, false);
      cam.setFromMatrixPosition(camera.matrixWorld);
      c3.setFromMatrixPosition(floatNode.matrixWorld);
      for (const l of pv.lamps) {
        v3.set(l[0], l[1], l[2]).applyMatrix4(floatNode.matrixWorld);
        // only the lamp on the side the camera sees (the far one is behind his envelope)
        const sx = v3.x - c3.x, sz = v3.z - c3.z, lx = cam.x - c3.x, lz = cam.z - c3.z;
        if ((sx * lx + sz * lz) / (Math.hypot(sx, sz) * Math.hypot(lx, lz) + 1e-9) < 0.15) continue;
        add(v3, 0.09 * S, 9, lampLevel);
      }
      if (eyeNode) {
        eyeNode.updateWorldMatrix(true, false);
        add(v3.set(0, 0, 0.1).applyMatrix4(eyeNode.matrixWorld), 0.07 * S, 7, lampLevel * 0.45);
      }
    };

    return {
      root,
      update(frame: Frame) {
        const w = frame.world;
        const v = pitchOf(w);
        root.visible = v !== null;
        if (!v) {
          shadows.set([]);
          return;
        }
        const t = frame.time;
        const dt = Math.min(0.05, Math.max(0, frame.dt));
        const reduced = w.reducedMotion;
        const still = w.still || reduced;
        for (const e of frame.events) {
          if (e.type === 'tell' && e.id === 'pitch') tellAt = t;
          if (e.type === 'misfire' && e.id === 'pitch') misfireAt = t;
        }
        if (w.bracketed && !wasBracketed) rungAt = t;
        wasBracketed = w.bracketed;
        const lv = w.machine('lamp');
        lampLevel = lv && lv.kind === 'lamp' && !lv.on ? 1 : 0.55;

        // ── where: between the last two steps ──
        if (w.step !== lastStep) {
          hPrev = lastStep < 0 || v.prevAt === v.at ? v.heading : hNow;
          hNow = v.heading;
          const sdt = lastStep < 0 ? 1 / 60 : Math.max(1, w.step - lastStep) / 60;
          const vv = v.velocity;
          acc = [(vv[0] - velPrev[0]) / sdt, (vv[1] - velPrev[1]) / sdt, (vv[2] - velPrev[2]) / sdt];
          velPrev = vv;
          lastStep = w.step;
        }
        const a = frame.alpha;
        const p0 = v.prevAt, p1 = v.at;
        const x = p0[0] + (p1[0] - p0[0]) * a, y = p0[1] + (p1[1] - p0[1]) * a, z = p0[2] + (p1[2] - p0[2]) * a;
        const heading = hPrev + wrap(hNow - hPrev) * a;

        // ── attitude, the view's own ──
        const vel = v.velocity;
        const level = Math.hypot(vel[0], vel[2]);
        const fx = Math.sin(heading), fz = Math.cos(heading);
        // the hand's pull (and a bump's) in his own frame: forward and sideways
        const af = acc[0] * fx + acc[2] * fz;
        const as = acc[0] * fz - acc[2] * fx;
        const held = v.state === 'held';
        const loose = v.state === 'sail';
        let wantPitch = clamp(vel[1] * L.climbPitch, -L.pitchMost, L.pitchMost);
        let wantRoll = clamp(-v.turn * level * L.bank, -L.bankMost, L.bankMost);
        if (held || loose) {
          // he swings under the hand like a balloon on a string: tail out behind, never over
          wantPitch += clamp(-af * L.swing * 0.5, -L.swingMost, L.swingMost);
          wantRoll += clamp(as * L.swing, -L.swingMost, L.swingMost);
        }
        const k = 1 - Math.exp(-L.follow * dt);
        att.pitch += (wantPitch - att.pitch) * k;
        att.roll += (wantRoll - att.roll) * k;
        // the tie: a spring pushed by his change of speed
        const tw: [number, number] = [clamp(af * L.tie, -L.tieMost, L.tieMost), clamp(-as * L.tie, -L.tieMost, L.tieMost)];
        for (let i = 0; i < 2; i++) {
          const kk = 60, cc = 7;
          att.tieV[i]! += (kk * (tw[i]! - att.tie[i]!) - cc * att.tieV[i]!) * dt;
          att.tie[i]! += att.tieV[i]! * dt;
        }
        att.prop += (still && v.state === 'moored' ? 0 : L.propIdle + Math.hypot(level, vel[1]) * L.propPer) * dt;

        // ── his face, by what he is doing ──
        const pose: PitchPose = { ...NEUTRAL, look: [0, 0], tie: [att.tie[0], att.tie[1]] };
        pose.pitch = NEUTRAL.pitch + att.pitch;
        pose.roll = att.roll;
        pose.prop = att.prop;
        pose.rudder = clamp(-v.turn * 18, -22, 22);
        pose.car = clamp(-att.roll * 0.4, -6, 6);
        const toLook = v.lookAt;
        let look: [number, number] = [Math.sin(t * 0.35) * 9, Math.sin(t * 0.23) * 3];
        let lid = 0.55;
        let hat = 0;
        if (toLook) {
          const dx = toLook[0] - x, dy = toLook[1] - y, dz = toLook[2] - z;
          const yaw = wrap(Math.atan2(dx, dz) - heading) * DEG;
          const pitchA = Math.atan2(dy, Math.hypot(dx, dz)) * DEG;
          look = [clamp(yaw, -35, 35), clamp(pitchA + att.pitch, -35, 30)];
        }
        const since = v.since;
        switch (v.state) {
          case 'moored':
            lid = 0.62;
            break;
          case 'pause':
            // looking down at the machine below: a proprietor's inspection
            lid = 0.5;
            pose.pitch -= 3 * smooth(0, 0.8, since);
            break;
          case 'held': {
            const hf = v.heldFor;
            const affront = 1 - smooth(0.45, 0.9, hf);
            lid = 0.05 + 0.6 * (1 - affront);
            hat = 0.22 * affront * smooth(0, 0.12, hf);
            pose.pitch += 4 + 4 * (1 - affront);
            look = [clamp(look[0], -25, 25), clamp(look[1] + 6, -20, 25)];
            if (affront > 0.5) pose.tie = [pose.tie[0] - 14 * affront, pose.tie[1]];
            break;
          }
          case 'sail':
            lid = 0.15;
            hat = 0.3;
            pose.roll += Math.sin(t * 5) * 4 * Math.max(0, 1 - since);
            break;
          case 'tray':
            // not pleased: heavy-lidded, nose up, eye on the visitor; now and then the tie set straight
            lid = 0.78;
            pose.pitch += 6;
            pose.tie = [pose.tie[0] + Math.sin(t * 3.2) * 6 * smooth(0.6, 1, Math.sin(t * 0.5)), pose.tie[1]];
            break;
          case 'door':
            lid = 0.7;
            pose.pitch += 4;
            break;
          case 'poked': {
            // he turns to the visitor and adjusts his tie: a tug, a settle
            lid = 0.4 + 0.25 * smooth(0.8, 1.4, since);
            const tug = Math.sin(clamp((since - 0.5) / 0.7, 0, 1) * Math.PI);
            pose.tie = [pose.tie[0] - 18 * tug, pose.tie[1] + 9 * Math.sin(since * 9) * tug];
            pose.pitch += 5 * smooth(0.9, 1.4, since);
            break;
          }
          default:
            lid = 0.55;
        }
        // after a loose spell: his hat set straight again on his way home (a lift, and down)
        if (v.ruffled && v.state !== 'sail' && v.state !== 'held') {
          const settle = clamp((v.since - 0.2) / 1.4, 0, 1);
          hat = Math.max(hat, 0.3 * (1 - settle) + 0.35 * Math.sin(Math.PI * settle));
          pose.tie = [pose.tie[0] - 10 * Math.sin(Math.PI * clamp((v.since - 1.2) / 0.8, 0, 1)), pose.tie[1]];
        }
        // the tell: his hat to the visitor
        const tg = t - tellAt;
        if (tg >= 0 && tg < 1.6) hat = Math.max(hat, Math.sin(Math.PI * clamp(tg / 1.6, 0, 1)));
        // a misfire: the engine coughs; he lurches and frowns
        const mg = t - misfireAt;
        if (mg >= 0 && mg < 1) {
          pose.prop += Math.sin(mg * 40) * 40;
          pose.roll += Math.sin(mg * 18) * 6 * (1 - mg);
          lid = Math.min(lid, 0.3);
        }
        // a Button rung: startled, then disapproving (performances only)
        if (w.bracketed) {
          const rg = t - rungAt;
          lid = rg < 0.5 ? 0.02 : 0.72;
          hat = Math.max(hat, rg < 0.5 ? 0.25 * Math.sin(Math.PI * rg * 2) : 0);
          look = [clamp(look[0] - 10, -35, 35), -4];
        }
        // bob and breathing while he floats (not in the hand, not on the tray; none with reduced motion)
        const floats = !still && v.state !== 'tray' && !held;
        pose.float = NEUTRAL.float + (floats ? Math.sin(t * L.bobRate) * L.bob : 0);
        if (still) {
          pose.tie = [0, 0];
          look = [0, 0];
        }
        att.look[0] += (look[0] - att.look[0]) * (1 - Math.exp(-6 * dt));
        att.look[1] += (look[1] - att.look[1]) * (1 - Math.exp(-6 * dt));
        pose.look = [att.look[0], att.look[1]];
        pose.lid = clamp(lid, 0, 1);
        pose.hat = clamp(hat, 0, 1);

        // ── placed: the kit's root is on the ground under his middle ──
        obj.position.set(x, y - RIG.float * S, z);
        obj.rotation.set(0, heading, 0);
        posePitch(obj, pose, pv);
        if (floatNode && floats) floatNode.scale.multiplyScalar(1 + Math.sin(t * L.breatheRate) * L.breathe);

        // ── paint: the platen's wipe while it works on him, his field at rest ──
        const self = w.part(v.body);
        if (self) {
          partShows(hooks, self, frame, work);
          const p = work.paint!;
          const settled = p.t >= 1 || p.t <= 0 || p.from === p.to;
          const shown = p.t <= 0 ? p.from : p.to;
          const changed = settled ? !drawn.settled || drawn.from !== shown : drawn.settled || drawn.from !== p.from || drawn.to !== p.to || Math.abs(drawn.t - p.t) > 1e-4;
          if (changed) {
            // (the wipe's axis into his piece's frame: turned back by his heading)
            const c = Math.cos(-heading), s = Math.sin(-heading);
            const axis: [number, number, number] = [p.axis[0] * c + p.axis[2] * s, p.axis[1], -p.axis[0] * s + p.axis[2] * c];
            if (settled) paintPitch(obj, { from: enamel(shown), to: enamel(shown), t: 1 });
            else paintPitch(obj, { from: enamel(p.from), to: enamel(p.to), t: p.t, axis });
            drawn.settled = settled;
            drawn.from = settled ? shown : p.from;
            drawn.to = p.to;
            drawn.t = p.t;
          }
        }

        // ── the blob under him ──
        const keel = y - 0.6;
        const g = groundUnder(w, x, z, keel, v.body);
        const hgt = Math.max(0, keel - g);
        const r = L.blobR + hgt * L.blobGrow;
        shadows.set([{ x, z, y: g, rx: r * 0.72, rz: r, angle: heading, strength: L.blobStrength / (1 + hgt * L.blobFade * 4) }]);
      },
      dispose() {
        shadows.dispose();
        root.removeFromParent();
      },
    };
  };
}

