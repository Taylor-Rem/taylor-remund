import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { listPieces, findPiece, firstPiece, buildEntry } from '../../../src/workshop/view/catalogue/registry.ts';
import { distanceFor, pxPerUnit, LENS, PHONE_SPAN, STATION_SPAN } from '../../../src/workshop/view/catalogue/distances.ts';
import { CameraRig } from '../../../src/workshop/view/stage/camera.ts';
import { TABLEAU, STAND_IN, shotCamera, standInPiece } from '../../../src/workshop/view/catalogue/tableau.ts';
import { VIEW_MODES, debugOf } from '../../../src/workshop/view/catalogue/views.ts';

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

  it('wide on a portrait phone frames the centre cluster across the narrow width', () => {
    const aspect = 390 / 844;
    const d = distanceFor('wide', aspect, unitBox);
    const ppu = pxPerUnit(d, 844);
    expect(390 / ppu).toBeCloseTo(PHONE_SPAN, 5);
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

  it('puts the crate left of the Button and a little forward (just dropped), Fetch to the right', () => {
    expect(TABLEAU.crate.x!).toBeLessThan(TABLEAU.button.x!);
    expect(TABLEAU.fetch.x!).toBeGreaterThan(TABLEAU.button.x!);
    expect(TABLEAU.crate.z!).toBeGreaterThan(TABLEAU.button.z!);
  });

  it('frames the group wider than any portrait, at both aspects', () => {
    const boxes = {
      button: new Box3(new Vector3(-0.3, 0, 1.3), new Vector3(0.9, 1.45, 2.4)),
      crate: new Box3(new Vector3(-1.4, 0, 2.2), new Vector3(-0.7, 0.6, 2.9)),
      fetch: new Box3(new Vector3(1.3, 0, 1.9), new Vector3(2.1, 1.3, 2.6)),
    };
    for (const aspect of [1440 / 900, 390 / 844]) {
      const g = shotCamera('three', boxes, aspect).distance;
      for (const s of ['button', 'crate', 'fetch'] as const) expect(shotCamera(s, boxes, aspect).distance).toBeLessThan(g);
    }
  });
});

describe('review views', () => {
  it('map onto the materials debug views (wire draws clay), beauty onto the real look', () => {
    expect(debugOf('beauty')).toBeUndefined();
    expect(debugOf('wire')).toBe('clay');
    for (const m of ['clay', 'wear', 'cavity', 'finish', 'lpos'] as const) expect(debugOf(m)).toBe(m);
    expect(VIEW_MODES).toContain('finish');
  });
});

describe('labels hook', () => {
  it('merges what an entry\'s hook returns into the build options, and builds blank without labels', () => {
    const seen: Record<string, unknown>[] = [];
    const e = {
      name: 'probe',
      build: (o: Record<string, unknown> = {}) => {
        seen.push(o);
        return standInPiece('crate');
      },
      variants: { M: { size: 'M' } },
      labels: (_l: unknown, o: Record<string, unknown>) => ({ stencil: true, sawSize: o['size'] }),
    };
    buildEntry(e, 'M', { seed: 3 });
    buildEntry(e, 'M', { seed: 3 }, {} as never);
    expect(seen[0]).toEqual({ size: 'M', seed: 3 });
    expect(seen[1]).toEqual({ size: 'M', seed: 3, stencil: true, sawSize: 'M' });
  });
});
