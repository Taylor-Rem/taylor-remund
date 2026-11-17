import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { listPieces, findPiece, firstPiece, buildEntry } from '../../../src/workshop/view/catalogue/registry.ts';
import { distanceFor, pxPerUnit, LENS, STATION_SPAN } from '../../../src/workshop/view/catalogue/distances.ts';
import { CameraRig } from '../../../src/workshop/view/stage/camera.ts';
import { TABLEAU, STAND_IN, shotBox, standInPiece } from '../../../src/workshop/view/catalogue/tableau.ts';
import { debugColours } from '../../../src/workshop/view/catalogue/views.ts';

const W = 1440;
const H = 900;
const ASPECT = W / H;
const unitBox = new Box3(new Vector3(-0.5, 0, -0.35), new Vector3(0.5, 1, 0.35));

describe('catalogue registry', () => {
  it('discovers the kit test block', async () => {
    const { entries } = await listPieces();
    expect(entries.map((e) => e.name)).toContain('test-block');
    const e = await findPiece('test-block');
    expect(e).toBeDefined();
    const p = buildEntry(e!, null, { detail: 'low' });
    expect(p.name).toBe('test-block');
    expect(p.triangles).toBeGreaterThan(100);
  });

  it('answers undefined for a piece not registered yet, and matches name prefixes', async () => {
    expect(await findPiece('no-such-piece')).toBeUndefined();
    expect(await firstPiece(['no-such-piece', 'test-*'])).toBeDefined();
  });

  it('names a missing variant clearly', async () => {
    const e = (await findPiece('test-block'))!;
    expect(() => buildEntry(e, 'nope')).toThrow(/no variant 'nope'/);
  });
});

describe('review distances at 1440x900, with the stage lens', () => {
  it('wide is the stage home distance: about 65-70 px per unit', () => {
    const d = distanceFor('wide', ASPECT, unitBox);
    const ppu = pxPerUnit(d, H);
    expect(ppu).toBeGreaterThan(63);
    expect(ppu).toBeLessThan(72);
    // and close to what the stage's own camera rig chooses for the whole bench at zoom 0
    const rig = new CameraRig();
    rig.setAspect(ASPECT);
    rig.cutTo(rig.home());
    expect(d / rig.distance).toBeGreaterThan(0.75);
    expect(d / rig.distance).toBeLessThan(1);
  });

  it('station shows about six units across', () => {
    const d = distanceFor('station', ASPECT, unitBox);
    const ppu = pxPerUnit(d, H);
    expect(W / ppu).toBeCloseTo(STATION_SPAN, 5);
  });

  it('close fills the frame with the piece', () => {
    const d = distanceFor('close', ASPECT, unitBox);
    const ppu = pxPerUnit(d, H);
    // a 1-unit-tall piece takes most of the 900 px height, and never less than half
    expect(ppu).toBeGreaterThan(450);
    expect(ppu).toBeLessThan(900);
    expect(d).toBeLessThan(distanceFor('station', ASPECT, unitBox));
  });

  it('uses the stage defaults for lens and pitch', () => {
    const rig = new CameraRig();
    expect(LENS.fov).toBe(rig.fov);
    expect(LENS.pitch).toBe(rig.pitch);
    expect(LENS.margin).toBe(rig.margin);
  });
});

describe('early-look tableau', () => {
  it('has a stand-in of the right size for each role', () => {
    for (const role of ['button', 'crate', 'fetch'] as const) {
      const p = standInPiece(role);
      expect(p.size.x).toBeCloseTo(STAND_IN[role].w, 3);
      expect(p.size.y).toBeCloseTo(STAND_IN[role].h, 3);
    }
  });

  it('puts the Button between the crate (left) and Fetch (right), in front of both', () => {
    expect(TABLEAU.crate.x!).toBeLessThan(TABLEAU.button.x!);
    expect(TABLEAU.fetch.x!).toBeGreaterThan(TABLEAU.button.x!);
    expect(TABLEAU.button.z!).toBeGreaterThan(TABLEAU.crate.z!);
  });

  it('frames the group around all three', () => {
    const boxes = {
      button: new Box3(new Vector3(-0.3, 0, 0.3), new Vector3(0.8, 1.45, 1.4)),
      crate: new Box3(new Vector3(-1.6, 0, 0.05), new Vector3(-1.0, 0.6, 0.65)),
      fetch: new Box3(new Vector3(1.4, 0, 0.25), new Vector3(2.2, 1.3, 0.95)),
    };
    const b = shotBox('three', boxes);
    for (const x of Object.values(boxes)) expect(b.containsBox(x)).toBe(true);
  });
});

describe('debug colours', () => {
  it('read surf.x as wear and lpos for bands, one colour per vertex', () => {
    const p = standInPiece('crate');
    const g = p.root.parts[0]!.geometry;
    const n = g.getAttribute('position').count;
    for (const m of ['clay', 'wear', 'cavity', 'lpos', 'wire'] as const) {
      const c = debugColours(g, m);
      expect(c.length).toBe(n * 3);
      expect(c.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    }
  });
});
