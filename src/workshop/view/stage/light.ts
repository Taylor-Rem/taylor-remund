/**
 * The light rig (art-direction § 4, REWRITE.md § A "Light does the work").
 *
 * One warm key (the lamp, a soft-shadowed spot at the bulb), a cool fill
 * (hemisphere with a warm bounce from the bench, plus a broad soft front
 * light), a cool rim from the window at the back right, and the generated
 * environment for reflections. Colours come from palette tokens through
 * ./colours.ts; intensities are the tuned starting values below.
 *
 * Driven later by the simulation: `setLamp({ level, colour })` (level 0 is
 * night: only bulbs, indicator lamps and eyes read) and `dip()` for the
 * Button.
 */
import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  PointLight,
  Object3D,
  SpotLight,
  Vector3,
  type Scene,
  type Texture,
} from 'three';
import type { Token } from '../palette.ts';
import { lampColourFrom, stageColours, type RGB } from './colours.ts';
import type { Tier } from '../types.ts';

export interface LightRigOptions {
  tier: Tier;
  /** Where the bulb is (the key spot's position). */
  bulb?: readonly [number, number, number];
  /** Where the lamp points. */
  aim?: readonly [number, number, number];
  /** The box the key's shadow must cover (the bench and what stands on it). */
  shadowBox?: Box3;
}

/** Tuned by eye on the stage dev page; see the W1 report for what each does. */
export const RIG = {
  key: { intensity: 230, angle: MathUtils.degToRad(60), penumbra: 1.0, decay: 2 },
  /**
   * `focus` narrows the shadow camera below the (wide, soft) cone: its field
   * is 2 × angle × focus, so a wide pool does not spread the 2048 map thin.
   * Outside that field things are simply lit (the bench ends, beyond the cluster).
   */
  shadow: { mapSize: 2048, radius: 4, blurSamples: 8, bias: -0.0004, normalBias: 0.025, focus: 0.8 },
  /**
   * `frontPosition`: low (about 20 degrees), so the front fill lights the faces the
   * camera sees and only grazes the tops; not lower, or its glossy reflection off
   * front-facing label tape (camera 33 degrees above) turns black tape pale.
   */
  fill: { hemi: 1.1, front: 3.0, frontPosition: [-3, 6, 16] as [number, number, number] },
  rim: { intensity: 2.4 },
  /** What bounces: warm light off the lit bench, from just above the pool (lifts the lower wall and undersides). */
  bounce: { intensity: 5, height: 1.1 },
  env: { intensity: 1.1 },
  /**
   * The sign's bulbs washing the back wall round them (warm, no shadows; high
   * tier only): what lets a sign and a pegboard on the wall read when the
   * key's pool is on the bench. `night` is the share it keeps at lamp level 0
   * (the sign's bulbs stay lit when the lamp is off).
   */
  wash: { intensity: 14, position: [0.4, 5.2, -2.4] as [number, number, number], distance: 11, decay: 2, night: 0.6 },
  /** What each part keeps at night (level 0), as a fraction of its day value. */
  night: { fill: 0.1, rim: 0.3, env: 0.12 },
};

const toColor = (c: RGB, out = new Color()): Color => out.fromArray(c);

export interface LampState {
  level: number;
  colour: Token | null;
}

export class LightRig {
  readonly root = new Object3D();
  readonly key: SpotLight;
  readonly hemi: HemisphereLight;
  readonly front: DirectionalLight;
  readonly rim: DirectionalLight;
  readonly bounce: PointLight;
  /** The sign's wall wash (high tier only; null on low). */
  readonly wash: PointLight | null;
  private readonly keyColour = new Color();
  private readonly defaultKey = new Color();
  private lamp: LampState = { level: 1, colour: null };
  /** The dip envelope: 0 = no dip, 1 = fully dipped. */
  private dipT = -1;
  private dipValue = 0;
  private envIntensity: number = RIG.env.intensity;
  private scene: Scene | null = null;
  /** Multiplier for scene.environmentIntensity set by the stage (so lamp level scales it). */
  envScale = 1;

  constructor(opts: LightRigOptions) {
    this.root.name = 'light-rig';
    const c = stageColours();
    toColor(c.key, this.defaultKey);
    this.keyColour.copy(this.defaultKey);

    // KEY: the lamp.
    const key = new SpotLight(this.keyColour, RIG.key.intensity, 0, RIG.key.angle, RIG.key.penumbra, RIG.key.decay);
    key.name = 'key';
    const bulb = opts.bulb ?? [-3.6, 5.2, -0.6];
    const aim = opts.aim ?? [0.6, 0, -0.1];
    key.position.set(bulb[0], bulb[1], bulb[2]);
    key.target.position.set(aim[0], aim[1], aim[2]);
    key.castShadow = opts.tier === 'high';
    key.shadow.mapSize.set(RIG.shadow.mapSize, RIG.shadow.mapSize);
    key.shadow.radius = RIG.shadow.radius;
    key.shadow.blurSamples = RIG.shadow.blurSamples;
    key.shadow.bias = RIG.shadow.bias;
    key.shadow.normalBias = RIG.shadow.normalBias;
    key.shadow.focus = RIG.shadow.focus;
    this.key = key;
    this.root.add(key, key.target);
    this.fitShadow(opts.shadowBox ?? new Box3(new Vector3(-10, -0.6, -5), new Vector3(10, 6, 5)));

    // FILL: cool sky, warm bounce from the wood below; and a broad soft front light.
    this.hemi = new HemisphereLight(toColor(c.hemiSky), toColor(c.hemiGround), RIG.fill.hemi);
    this.hemi.name = 'fill-hemi';
    this.front = new DirectionalLight(toColor(c.fill), RIG.fill.front);
    this.front.name = 'fill-front';
    this.front.position.set(...RIG.fill.frontPosition);
    this.front.target.position.set(0, 0, 0);
    this.root.add(this.hemi, this.front, this.front.target);

    // RIM: the window, back right; no shadows.
    this.rim = new DirectionalLight(toColor(c.rim), RIG.rim.intensity);
    this.rim.name = 'rim';
    this.rim.position.set(9, 6.5, -10);
    this.rim.target.position.set(0, 0.5, 0);
    this.root.add(this.rim, this.rim.target);

    // BOUNCE: the lit bench throws warm light back up. No shadows.
    this.bounce = new PointLight(toColor(c.bounce), RIG.bounce.intensity, 0, 2);
    this.bounce.name = 'bounce';
    this.bounce.position.set(aim[0], RIG.bounce.height, aim[2]);
    this.root.add(this.bounce);

    // WASH: the sign's bulbs on the back wall. High tier only.
    if (opts.tier === 'high') {
      this.wash = new PointLight(toColor(c.wash), RIG.wash.intensity, RIG.wash.distance, RIG.wash.decay);
      this.wash.name = 'wash';
      this.wash.position.set(...RIG.wash.position);
      this.root.add(this.wash);
    } else {
      this.wash = null;
    }
  }

  /**
   * Fit the key's shadow camera to a box: near and far from the box's nearest
   * and farthest corners as seen from the bulb, so depth precision is spent
   * on the bench and nowhere else.
   */
  fitShadow(box: Box3): void {
    const p = this.key.position;
    let near = Infinity;
    let far = 0;
    const c = new Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const d = c.distanceTo(p);
      near = Math.min(near, d);
      far = Math.max(far, d);
    }
    // The box may contain the bulb (a tall back wall); never go below a small near plane.
    const cam = this.key.shadow.camera;
    cam.near = Math.max(0.3, Math.min(near, 2.5) * 0.5);
    cam.far = far * 1.05;
    cam.updateProjectionMatrix();
  }

  attach(scene: Scene, environment: Texture | null): void {
    this.scene = scene;
    scene.add(this.root);
    scene.environment = environment;
    this.apply();
  }

  /** The bulb's world position (for a kit lamp to sit its bulb at, or the reverse). */
  setBulb(pos: readonly [number, number, number], aim?: readonly [number, number, number]): void {
    this.key.position.set(pos[0], pos[1], pos[2]);
    if (aim) {
      this.key.target.position.set(aim[0], aim[1], aim[2]);
      this.bounce.position.set(aim[0], aim[1] + RIG.bounce.height, aim[2]);
    }
    this.key.target.updateMatrixWorld();
  }

  setLamp(state: Partial<LampState>): void {
    this.lamp = {
      level: MathUtils.clamp(state.level ?? this.lamp.level, 0, 1),
      colour: state.colour === undefined ? this.lamp.colour : state.colour,
    };
    if (this.lamp.colour) toColor(lampColourFrom(this.lamp.colour), this.keyColour);
    else this.keyColour.copy(this.defaultKey);
    this.key.color.copy(this.keyColour);
    this.apply();
  }

  get lampState(): Readonly<LampState> {
    return this.lamp;
  }

  /** A momentary dip of the lamp (the Button): drops fast, stutters once, recovers. */
  dip(): void {
    this.dipT = 0;
  }

  /** The effective lamp level now (level × dip). */
  get effectiveLevel(): number {
    return this.lamp.level * (1 - this.dipValue);
  }

  update(dt: number): void {
    if (this.dipT >= 0) {
      this.dipT += Math.min(dt, 0.1);
      const t = this.dipT;
      // 0 → 0.08 s: down to 85 % dark; a stutter at 0.2 s; back over 0.7 s.
      let v: number;
      if (t < 0.08) v = (t / 0.08) * 0.85;
      else if (t < 0.18) v = 0.85;
      else if (t < 0.24) v = 0.45;
      else if (t < 0.3) v = 0.75;
      else v = 0.75 * (1 - MathUtils.smoothstep(t, 0.3, 1.0));
      this.dipValue = v;
      if (t >= 1.0) {
        this.dipT = -1;
        this.dipValue = 0;
      }
      this.apply();
    }
  }

  /** Re-read RIG (after tuning it live from the debug object). */
  refresh(): void {
    this.key.angle = RIG.key.angle;
    this.key.penumbra = RIG.key.penumbra;
    this.key.decay = RIG.key.decay;
    this.key.shadow.radius = RIG.shadow.radius;
    this.key.shadow.bias = RIG.shadow.bias;
    this.key.shadow.normalBias = RIG.shadow.normalBias;
    this.key.shadow.focus = RIG.shadow.focus;
    if (this.wash) {
      this.wash.position.set(...RIG.wash.position);
      this.wash.distance = RIG.wash.distance;
      this.wash.decay = RIG.wash.decay;
    }
    this.front.position.set(...RIG.fill.frontPosition);
    this.apply();
  }

  private apply(): void {
    const l = this.effectiveLevel;
    this.key.intensity = RIG.key.intensity * l;
    // The key stays visible at level 0 so the light count (and every shader) never changes.
    const nf = MathUtils.lerp(RIG.night.fill, 1, l);
    this.hemi.intensity = RIG.fill.hemi * nf;
    this.front.intensity = RIG.fill.front * nf;
    this.rim.intensity = RIG.rim.intensity * MathUtils.lerp(RIG.night.rim, 1, l);
    this.bounce.intensity = RIG.bounce.intensity * l;
    if (this.wash) this.wash.intensity = RIG.wash.intensity * MathUtils.lerp(RIG.wash.night, 1, l);
    this.envIntensity = RIG.env.intensity * MathUtils.lerp(RIG.night.env, 1, l);
    if (this.scene) this.scene.environmentIntensity = this.envIntensity * this.envScale;
  }

  /** Shadows on or off (tier changes, the debug object). */
  setShadows(on: boolean): void {
    this.key.castShadow = on;
  }

  dispose(): void {
    this.key.shadow.dispose();
    this.root.removeFromParent();
  }
}
