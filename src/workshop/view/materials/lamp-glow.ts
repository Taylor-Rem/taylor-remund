/**
 * The lamp's own lit parts (its bulb, the liner's glow, the crown's vents) take the lamp's
 * colour (REWRITE.md § B2 X1 "make it blue"). They are the `bulb` class in its 'lamp' variant
 * (kit/types.ts MaterialVariant), whose shader reads these two uniforms; the stage's light rig
 * (stage/light.ts) writes them as the lamp's colour crosses over. Every other bulb ignores them.
 *
 *   c_lampGlow     linear rgb at unit luminance: the hue the glow takes
 *   u_lampGlowMix  0: the bulb's own amber (the warm lamp), 1: the lamp's colour at the glow's own luminance
 */
import { Vector3 } from 'three';

export const LAMP_GLOW = {
  c_lampGlow: { value: new Vector3(1, 1, 1) },
  u_lampGlowMix: { value: 0 },
};
