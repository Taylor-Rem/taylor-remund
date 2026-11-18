// The light rig and the lamp (H1 round 3): levels to 2 (the key alone above 1), a colour that
// crosses over into the key, the fill and the lamp's own glow, the shadow camera refitted by setBulb.
import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { LightRig, RIG } from '../../../src/workshop/view/stage/light.ts';
import { lampLighting, luminance, stageColours } from '../../../src/workshop/view/stage/colours.ts';
import { LAMP_GLOW } from '../../../src/workshop/view/materials/lamp-glow.ts';
import { paints } from '../../../src/workshop/view/palette.ts';

describe('the lamp level', () => {
  it('runs 0..2; above 1 only the key brightens', () => {
    const rig = new LightRig({ tier: 'high', reducedMotion: true });
    rig.setLamp({ level: 1 });
    const day = { key: rig.key.intensity, hemi: rig.hemi.intensity, front: rig.front.intensity, rim: rig.rim.intensity, bounce: rig.bounce.intensity };
    rig.setLamp({ level: 1.6 });
    expect(rig.key.intensity).toBeCloseTo(day.key * 1.6, 6);
    expect(rig.hemi.intensity).toBe(day.hemi);
    expect(rig.front.intensity).toBe(day.front);
    expect(rig.rim.intensity).toBe(day.rim);
    expect(rig.bounce.intensity).toBe(day.bounce);
    rig.setLamp({ level: 9 });
    expect(rig.lampState.level).toBe(RIG.maxLevel);
    rig.setLamp({ level: 0 });
    expect(rig.key.intensity).toBe(0);
    expect(rig.hemi.intensity).toBeGreaterThan(0); // night is dark, never black
  });
});

describe('the lamp colour', () => {
  it('a paint turns the key to its hue at unit luminance; the fill follows a little; the glow takes the paint', () => {
    const rig = new LightRig({ tier: 'high', reducedMotion: true });
    rig.setLamp({ colour: 'paint-blue' });
    const k = rig.key.color;
    expect(k.b).toBeGreaterThan(k.r * 3);
    expect(luminance([k.r, k.g, k.b])).toBeCloseTo(1, 5);
    const fill0 = stageColours().fill;
    expect(rig.front.color.b / rig.front.color.r).toBeGreaterThan(fill0[2] / fill0[0]);
    expect(LAMP_GLOW.u_lampGlowMix.value).toBe(1);
    expect(LAMP_GLOW.c_lampGlow.value.z).toBeGreaterThan(LAMP_GLOW.c_lampGlow.value.x);
    rig.setLamp({ colour: null });
    expect(LAMP_GLOW.u_lampGlowMix.value).toBe(0);
  });

  it('crosses over in about a third of a second (most of the way), and tells the stage to retint the environment once', () => {
    const rig = new LightRig({ tier: 'high' });
    let rebuilt = 0;
    rig.onEnvironment = () => rebuilt++;
    rig.setLamp({ colour: 'cable-red' });
    expect(rebuilt).toBe(1);
    const warm = stageColours().key;
    expect(rig.key.color.r).toBeCloseTo(warm[0], 5); // nothing yet
    for (let i = 0; i < 10; i++) rig.update(1 / 30);
    // a third of a second: most of the way
    expect(rig.key.color.r).toBeGreaterThan(warm[0] + 0.9 * (lampLighting('cable-red').key[0] - warm[0]));
    for (let i = 0; i < 30; i++) rig.update(1 / 30);
    const red = lampLighting('cable-red').key;
    expect(rig.key.color.r).toBeCloseTo(red[0], 2);
    rig.setLamp({ level: 0.5 });
    expect(rebuilt).toBe(1);
  });

  it('every paint is a believable coloured light: unit luminance, clearly away from white', () => {
    for (const p of paints) {
      const k = lampLighting(p).key;
      expect(luminance(k), p).toBeCloseTo(1, 5);
      const spread = Math.max(...k) - Math.min(...k);
      if (p !== 'paper') expect(spread, p).toBeGreaterThan(0.6);
    }
  });
});

describe('setBulb keeps the shadow camera fitted', () => {
  it('refits near and far when the bulb has moved more than RIG.refit', () => {
    const rig = new LightRig({ tier: 'high', shadowBox: new Box3(new Vector3(-10, -0.6, -5), new Vector3(10, 6, 5)) });
    const cam = rig.key.shadow.camera;
    const far0 = cam.far;
    rig.setBulb([-3.6 + 0.2, 5.2, -0.6]);
    expect(cam.far).toBe(far0);
    rig.setBulb([8, 3, 3]);
    expect(cam.far).not.toBe(far0);
  });
});
