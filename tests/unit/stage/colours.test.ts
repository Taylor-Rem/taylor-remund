import { describe, expect, it } from 'vitest';
import { linear } from '../../../src/workshop/view/palette.ts';
import { lampColourFrom, luminance, stageColours } from '../../../src/workshop/view/stage/colours.ts';
import { defaultPanels, envRadiance } from '../../../src/workshop/view/stage/environment.ts';
import { MeshBasicMaterial } from 'three';
import { BlobShadows } from '../../../src/workshop/view/effects/blob-shadows.ts';

const c = stageColours();
const warm = (rgb: readonly number[]): boolean => rgb[0]! > rgb[1]! && rgb[1]! > rgb[2]!;
const cool = (rgb: readonly number[]): boolean => rgb[2]! > rgb[0]!;

describe('stage colours: derived from palette tokens in code', () => {
  it('the key (the lamp) is warm and the fill and rim are cool', () => {
    expect(warm(c.key)).toBe(true);
    expect(cool(c.fill)).toBe(true);
    expect(cool(c.rim)).toBe(true);
    expect(cool(c.hemiSky)).toBe(true);
    expect(warm(c.hemiGround)).toBe(true);
  });

  it('light colours have unit luminance, so intensity is a separate knob', () => {
    for (const k of ['key', 'fill', 'rim', 'hemiSky', 'hemiGround', 'gradeShadow', 'gradeLight'] as const) {
      expect(luminance(c[k])).toBeCloseTo(1, 6);
    }
  });

  it('the room is exactly teal-deep, never black', () => {
    expect(c.room).toEqual(linear('teal-deep'));
    expect(luminance(c.room)).toBeGreaterThan(0.01);
  });

  it('occlusion darkens toward teal, not grey', () => {
    expect(c.occlusion[1]).toBeGreaterThan(c.occlusion[0]);
    expect(c.occlusion[2]).toBeGreaterThan(c.occlusion[0]);
    for (const v of c.occlusion) expect(v).toBeLessThanOrEqual(1);
  });

  it('blob shadows are a deep teal, darker than the room and not black', () => {
    expect(luminance(c.blob)).toBeLessThan(luminance(c.room));
    expect(c.blob[1]).toBeGreaterThan(c.blob[0]);
  });

  it('the lamp can be recoloured from any token', () => {
    const red = lampColourFrom('button-red');
    expect(red[0]).toBeGreaterThan(red[2]);
    expect(luminance(red)).toBeCloseTo(1, 6);
  });
});

describe('the generated environment', () => {
  const panels = defaultPanels();
  const rad = (d: [number, number, number]) => envRadiance(d, panels, c.envRoom, c.envFloor, 3.5);

  it('is bright and warm toward the lamp, bright and cool toward the window', () => {
    const lamp = rad(panels[0]!.dir as [number, number, number]);
    const win = rad(panels[1]!.dir as [number, number, number]);
    expect(warm(lamp)).toBe(true);
    expect(cool(win)).toBe(true);
    expect(luminance(lamp)).toBeGreaterThan(2);
    expect(luminance(win)).toBeGreaterThan(2);
  });

  it('is a dim teal room elsewhere, and a warm dark bench below', () => {
    const away = rad([0, 0.2, 1]);
    expect(luminance(away)).toBeLessThan(0.3);
    expect(away[1]).toBeGreaterThan(away[0]);
    const below = rad([0, -1, 0]);
    expect(warm(below)).toBe(true);
  });
});

describe('blob shadows', () => {
  it('draw with the decal they are given and put strength × opacity in the instance colour', () => {
    const decal = new MeshBasicMaterial();
    decal.opacity = 0.8;
    const b = new BlobShadows(decal, 4, 0.4);
    expect(b.mesh.material).toBe(decal);
    b.set([{ x: 1, z: 2, rx: 0.5, rz: 0.3, strength: 1 }, { x: 0, z: 0, rx: 1, rz: 1, strength: 0.5 }]);
    expect(b.mesh.count).toBe(2);
    expect(b.mesh.instanceColor!.getX(0)).toBeCloseTo(0.5, 6);
    expect(b.mesh.instanceColor!.getX(1)).toBeCloseTo(0.25, 6);
    b.dispose();
  });
});
