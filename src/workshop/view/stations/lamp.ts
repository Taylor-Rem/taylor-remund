/**
 * The lamp's behaviour (REWRITE.md § B4 rung 1 "the lamp dips", § B1, § A
 * "Light"; W4 brief § B). The key light is the stage's; this view decides
 * what it does over time:
 *
 *  - its level and colour: the setting `<id>.level` / `<id>.colour` when the
 *    simulation defines them (a handle will, later), else what `setLevel` /
 *    `setColour` asked for, else full. A filament has thermal lag: it warms
 *    up quickly and cools a little slower, never a cut;
 *  - the dip, on the simulation's `misfire` of the lamp: a brownout that
 *    drops fast, holds, stutters once, and recovers like a filament warming
 *    (one small sag on the way). With reduced motion: a plain dip and
 *    recovery, no stutter;
 *  - the rewind (`rung.rewinding`): the dip plays backwards with the rest
 *    of the world, so the lamp swells back to full exactly as the rewind
 *    lands, with a slow tape-wow on the light while the bench runs
 *    backwards (2.4 a second, 0.15 deep: § B4's "no flashing faster
 *    than three times a second" is kept);
 *  - the lamp's body: when a `lamp` piece is registered in the kit, it is
 *    stood so its `bulb` socket is where the key light is, and the key is
 *    moved to that socket (`lights.setBulb`).
 *
 * Every curve runs on `frame.time`. Bulbs everywhere dim with the lamp
 * during a dip (same circuit) when the materials expose the bulb dimmer.
 */
import { Group, Matrix4, Vector3 } from 'three';
import type { Id } from '../../sim/types.ts';
import type { Frame, StationView, ViewContext } from '../types.ts';
import type { Token } from '../palette.ts';
import { palette } from '../palette.ts';

/** Tune here. Times in seconds. */
export const LAMP_FEEL = {
  /** Thermal lag of the filament toward a new level: rates (1/s) up and down. */
  warm: 11,
  cool: 7,
  /** The rewind's tape-wow: rate (Hz, under 3) and depth (fraction of the level). */
  wowHz: 2.4,
  wowDepth: 0.15,
  /** Bulbs keep at least this share of their glow at the bottom of a dip. */
  bulbFloor: 0.35,
} as const;

/** The brownout, as a level multiplier, `t` seconds after the misfire. */
export function dipCurve(t: number, reduced = false): number {
  if (t < 0) return 1;
  const lerp = (a: number, b: number, k: number): number => a + (b - a) * Math.min(1, Math.max(0, k));
  const smooth = (k: number): number => {
    const x = Math.min(1, Math.max(0, k));
    return x * x * (3 - 2 * x);
  };
  if (reduced) {
    if (t < 0.1) return lerp(1, 0.3, smooth(t / 0.1));
    if (t < 0.35) return 0.3;
    if (t < 1.2) return lerp(0.3, 1, smooth((t - 0.35) / 0.85));
    return 1;
  }
  // drop: the filament browns out in three frames
  if (t < 0.05) return lerp(1, 0.14, (t / 0.05) ** 1.5);
  // hold, glowing dull
  if (t < 0.27) return 0.14 + 0.03 * Math.sin((t - 0.05) * 9);
  // one stutter: the supply catches, then sags
  if (t < 0.34) return lerp(0.15, 0.62, smooth((t - 0.27) / 0.07));
  if (t < 0.45) return lerp(0.62, 0.28, smooth((t - 0.34) / 0.11));
  // recovery: a filament warming (fast, then slower), one small sag at 0.8 s
  if (t < 1.35) {
    const k = (t - 0.45) / 0.9;
    const warm = 1 - Math.exp(-k * 4.2);
    const base = lerp(0.28, 1, warm / (1 - Math.exp(-4.2)));
    const sag = t > 0.76 && t < 0.98 ? Math.sin(((t - 0.76) / 0.22) * Math.PI) * 0.16 : 0;
    return Math.min(1, base * (1 - sag));
  }
  return 1;
}

export interface LampViewOptions {
  /** The lamp fixture's id (its misfires dip it; its settings drive it). Default 'lamp'. */
  id?: Id;
  /** Look for a `lamp` piece in the kit registry and stand it (default true). */
  body?: boolean;
}

export interface LampView extends StationView {
  /** The lamp's level now (0..1), after dip and wow. */
  readonly level: number;
  /** Ask for a level (when the simulation does not hold one). The filament eases there. */
  setLevel(level: number): void;
  /** Ask for a colour (a palette token, or null for the lamp's own). */
  setColour(colour: Token | null): void;
  /** Dip now, as a misfire would (dev pages). */
  dip(): void;
}

/** What the boot's materials offer beyond the contract (the bulb dimmer). */
interface Dimmable {
  set?(cls: 'bulb', param: string, value: number): void;
}

export function createLampView(opts: LampViewOptions = {}): (ctx: ViewContext) => LampView {
  return (ctx) => {
    const id = opts.id ?? 'lamp';
    const root = new Group();
    root.name = 'lamp';
    ctx.scene.add(root);
    const lights = ctx.stage.lights;
    const reduced = ctx.reducedMotion;

    let asked = 1;
    let askedColour: Token | null = null;
    let base = lights.lampState.level;
    let dipAt = -Infinity;
    let pendingDip = false;
    let rungAt = 0;
    let flinch = 3;
    let rewAt = -Infinity;
    let rewDur = 1.2;
    let level = 1;
    let lastSent = -1;
    let lastColour: Token | null | undefined;
    let lastBulb = -1;
    const dim = ctx.materials as unknown as Dimmable;

    // the body, when a builder has registered it
    if (opts.body ?? true) void standBody(ctx, root);

    const view: LampView = {
      root,
      get level() {
        return level;
      },
      setLevel(l) {
        asked = Math.min(1, Math.max(0, l));
      },
      setColour(c) {
        askedColour = c;
      },
      dip() {
        pendingDip = true;
      },
      update(frame: Frame) {
        const w = frame.world;
        const now = frame.time;
        if (pendingDip) {
          pendingDip = false;
          dipAt = now;
        }
        for (const e of frame.events) {
          if (e.type === 'misfire' && e.id === id) dipAt = now;
          else if (e.type === 'rung.started') {
            rungAt = now;
            flinch = e.duration;
            rewAt = -Infinity;
          } else if (e.type === 'rung.rewinding') {
            rewAt = now;
            rewDur = e.duration;
          } else if (e.type === 'rung.ended') rewAt = -Infinity;
        }
        // the level asked for: the simulation's setting first
        const sl = w.setting(id, 'level');
        const sc = w.setting(id, 'colour');
        const target = typeof sl === 'number' ? Math.min(1, Math.max(0, sl)) : asked;
        const colour = typeof sc === 'string' && sc in palette ? (sc as Token) : askedColour;
        const dt = Math.min(frame.dt, 0.1);
        const rate = target > base ? LAMP_FEEL.warm : LAMP_FEEL.cool;
        base += (target - base) * (reduced ? 1 : 1 - Math.exp(-rate * dt));

        // where on the dip's curve we are: during a rewind, time runs backwards through the rung
        const rewinding = w.button().phase === 'rewinding' && rewAt > -Infinity;
        let since = now - dipAt;
        let wow = 1;
        if (rewinding) {
          const tau = Math.max(0, now - rewAt);
          const k = Math.min(1, tau / Math.max(1e-3, rewDur));
          since = rungAt + flinch * (1 - k) - dipAt;
          if (!reduced) wow = 1 - LAMP_FEEL.wowDepth * (0.5 - 0.5 * Math.cos(2 * Math.PI * LAMP_FEEL.wowHz * tau)) * Math.sin(Math.PI * k);
        }
        const env = dipCurve(since, reduced);
        level = base * env * wow;
        if (Math.abs(level - lastSent) > 1e-4 || colour !== lastColour) {
          lights.setLamp(colour !== lastColour ? { level, colour } : { level });
          lastSent = level;
          lastColour = colour;
        }
        const bulb = LAMP_FEEL.bulbFloor + (1 - LAMP_FEEL.bulbFloor) * env;
        if (dim.set && Math.abs(bulb - lastBulb) > 1e-4) {
          dim.set('bulb', 'intensity', bulb);
          lastBulb = bulb;
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
    return view;
  };
}

/** Stand the kit's lamp (if registered) so its bulb is where the key light is, and move the key to the socket. */
async function standBody(ctx: ViewContext, root: Group): Promise<void> {
  let reg: typeof import('../kit/pieces/registry.ts');
  try {
    reg = await import('../kit/pieces/registry.ts');
  } catch {
    return; // no registry outside Vite (unit tests)
  }
  if (!reg.pieceFolders().includes('lamp')) return;
  const entry = (await reg.loadFolder('lamp')).find((e) => e.name === 'lamp');
  if (!entry) return;
  const extra = entry.labels?.(ctx.labels, {}) ?? {};
  const piece = reg.buildCached(entry, extra);
  const socket = piece.sockets?.['bulb'];
  if (!socket) return;
  const obj = ctx.realize(piece);
  const key = ctx.stage.lights.key;
  const at = new Vector3().setFromMatrixPosition(socket);
  // stand it so the bulb socket lands on the key light's place
  obj.position.copy(key.position).sub(at);
  root.add(obj);
  obj.updateMatrixWorld(true);
  const world = new Matrix4().multiplyMatrices(obj.matrixWorld, socket);
  const p = new Vector3().setFromMatrixPosition(world);
  const aim = key.target.position;
  ctx.stage.lights.setBulb([p.x, p.y, p.z], [aim.x, aim.y, aim.z]);
}
