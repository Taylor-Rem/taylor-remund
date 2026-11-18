// The picture-first handoff's geometry and bookkeeping (B1): which picture a
// screen gets, and that the live camera adopting the picture's view sees the
// picture exactly (a world point lands on the same screen pixel through the
// picture's cover crop and through the live camera).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  bandFor,
  coverRect,
  coverSizes,
  cropIsExact,
  entryForUrl,
  makeBands,
  minAspectQuery,
  pictureSources,
  pixelSize,
  warmth,
  widestFirst,
  type PosterSet,
} from '../../../src/workshop/shell/poster.ts';
import { adoptView, bandView, Progress, PHASE_WEIGHTS, stepToPicture, viewOf } from '../../../src/workshop/shell/loader.ts';
import { CameraRig } from '../../../src/workshop/view/stage/camera.ts';
import type { Stage } from '../../../src/workshop/view/stage/index.ts';
import { vignette } from '../../../src/workshop/sim/index.ts';

const SET_PATH = join(process.cwd(), 'src/dev-pages/handoff/posters.json');
const set = JSON.parse(readFileSync(SET_PATH, 'utf8')) as PosterSet;

// ── the vignette's framing (src/dev-pages/handoff.astro, from view/vignette.ts), on a stage stand-in ──
const WIDE = new Box3(new Vector3(-6.0, 0, -5), new Vector3(6.6, 4.5, 4.6));
const PHONE = new Box3(new Vector3(-1.6, 0, -3.9), new Vector3(4.15, 1.9, 2.9));
function fakeStage(w: number, h: number): Stage {
  const rig = new CameraRig({ stationSize: 1.6 });
  rig.setAspect(w / h);
  return { camera: rig, renderer: { domElement: { clientWidth: w, clientHeight: h, width: w, height: h } } } as unknown as Stage;
}
function frameVignette(stage: Stage, w: number, h: number): void {
  const b = vignette.bench;
  stage.camera.stationSize = 1.6;
  stage.camera.setSubject(w < h ? PHONE : WIDE, { edge: { y: b.top, z: b.maxZ }, bounds: new Box3(new Vector3(b.minX, -1, b.minZ), new Vector3(b.maxX, 5, b.maxZ)) });
  stage.camera.cutTo(stage.camera.home());
}
/** The camera a band's picture is taken from: the page at the band's pixel size, framed, made valid for the band. */
function pictureCamera(i: number): { stage: Stage; w: number; h: number } {
  const b = set.posters[i]!;
  const { width: w, height: h } = pixelSize(b);
  const stage = fakeStage(w, h);
  frameVignette(stage, w, h);
  bandView(stage, i === 0 ? set.narrowest : b.minAspect);
  return { stage, w, h };
}
/** Where a world point lands on screen, in pixels. */
function px(rig: CameraRig, p: Vector3, w: number, h: number): [number, number] {
  rig.camera.updateMatrixWorld(true);
  const v = p.clone().project(rig.camera);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

describe('bands', () => {
  it('the set is contiguous: each band is rendered at the next band’s start, widest last', () => {
    const bands = [...set.posters].sort((a, b) => a.minAspect - b.minAspect);
    expect(bands[0]!.minAspect).toBe(0);
    for (let i = 0; i + 1 < bands.length; i++) {
      const next = bands[i + 1]!.minAspect;
      expect(bands[i]!.aspect).toBeLessThanOrEqual(next);
      expect(next - bands[i]!.aspect).toBeLessThan(0.002);
    }
    expect(bands.at(-1)!.aspect).toBeGreaterThanOrEqual(2.33); // a 21:9 screen still gets an exact crop
  });

  it('makeBands keeps each band within the ratio and splits at aspect 1', () => {
    const b = makeBands({ narrowest: 0.42, wideFrom: 1.529, widest: 2.4, ratio: 1.14, height: { portrait: 900, landscape: 1080 }, densities: { portrait: [1, 2], landscape: [1] } });
    expect(b.map((x) => [x.minAspect, x.aspect, x.height])).toEqual(set.posters.map((x) => [x.minAspect, x.aspect, x.height]));
    for (const x of b.slice(1, -1)) expect(x.aspect / x.minAspect).toBeLessThanOrEqual(1.14 + 1e-3);
    expect(b.some((x) => x.minAspect === 1)).toBe(true);
  });

  it('a screen gets the widest band it reaches; media queries and sources run widest first', () => {
    expect(bandFor(set.posters, 1.6)!.aspect).toBe(2.4);
    expect(bandFor(set.posters, 1440 / 900)!.minAspect).toBe(1.529);
    expect(bandFor(set.posters, 390 / 844)!.minAspect).toBe(0);
    expect(bandFor(set.posters, 1)!.minAspect).toBe(1);
    expect(bandFor(set.posters, 0.999)!.aspect).toBe(0.999);
    expect(minAspectQuery(1.529)).toBe('(min-aspect-ratio: 1529/1000)');
    expect(coverSizes(2.4)).toBe('max(100vw, 240.0vh)');
    const fake: PosterSet = { ...set, posters: set.posters.map((p, i) => ({ ...p, files: [{ file: `b${i}.avif`, width: 10, height: 10, density: 1, type: 'image/avif', bytes: 1 }] })) };
    const s = pictureSources(fake, (f) => `/x/${f}`);
    expect(s.map((x) => x.media)).toEqual([...widestFirst(fake.posters).slice(0, -1).map((p) => minAspectQuery(p.minAspect)), null]);
    expect(entryForUrl(fake, 'https://h/x/b3.avif?v=1', (f) => `/x/${f}`)!.minAspect).toBe(fake.posters[3]!.minAspect);
    expect(entryForUrl(fake, '', (f) => `/x/${f}`)).toBeNull();
  });

  it('the files the set lists exist, and the fallback <img> is the widest band’s', () => {
    const files = set.posters.flatMap((p) => p.files);
    for (const f of files) expect(existsSync(join(dirname(SET_PATH), f.file)), f.file).toBe(true);
    if (files.length) {
      expect(widestFirst(set.posters)[0]!.files.some((f) => f.file === set.fallback)).toBe(true);
      for (const p of set.posters) expect(p.view, `band ${p.minAspect} has its camera`).not.toBeNull();
    }
  });
});

describe('the live camera sees the picture', () => {
  it('a horizontal cover crop is exact; a vertical one is not', () => {
    expect(cropIsExact(2.4, 1.6)).toBe(true);
    expect(cropIsExact(2.4, 2.4)).toBe(true);
    expect(cropIsExact(0.475, 0.5)).toBe(false);
    const r = coverRect(2.4, 1440, 900);
    expect(r.height).toBe(900);
    expect(r.width).toBeCloseTo(2160, 9);
    expect(r.x).toBeCloseTo(-360, 9);
  });

  // every band, at its narrowest and at its widest aspect and in between, at a few heights (and the four proof sizes)
  const cases: [number, number, number][] = [];
  set.posters.forEach((b, i) => {
    const lo = Math.max(b.minAspect, set.narrowest);
    for (const t of [0, 0.37, 0.81, 1]) {
      const a = lo + (b.aspect - lo) * t;
      // loader.ts adoptView holds the view (camera.ts cutTo { hold: true }; tested below), so the band holds even at 1.84-1.96:1, where the
      // live pan range excludes the band's view (bandView clamps at the narrowest aspect; the x range is not monotone in aspect)
      // whole pixels that stay inside the band
      const w = t === 0 ? Math.ceil(a * 900) : Math.floor(a * 900);
      cases.push([i, w, 900]);
    }
  });
  cases.push([set.posters.length - 1, 1440, 900], [set.posters.length - 1, 1920, 1080], [set.posters.length - 1, 1280, 720], [0, 390, 844]);

  it.each(cases)('band %i on a %i×%i screen: adopted with no correction, every point on the same pixel', (i, w, h) => {
    const pic = pictureCamera(i);
    const view = viewOf(pic.stage);
    const live = fakeStage(w, h);
    frameVignette(live, w, h);
    // the rig may nudge the view by a hair (its pan limits at this exact aspect): under a tenth of a pixel
    const err = adoptView(live, view);
    const pxPerUnit = h / (2 * Math.tan((live.camera.fov * Math.PI) / 360) * live.camera.distance);
    expect(err * pxPerUnit).toBeLessThan(0.1);
    const cover = coverRect(pic.w / pic.h, w, h);
    // corners and middle of the bench, the wall's top, a point in the air
    const pts = [new Vector3(-6, 0, 4.6), new Vector3(6.6, 0, 4.6), new Vector3(0.3, 0.5, 0), new Vector3(-6, 4.5, -5), new Vector3(6.6, 4.5, -5), new Vector3(2, 1.2, -2)];
    for (const p of pts) {
      const [px0, py0] = px(pic.stage.camera, p, pic.w, pic.h);
      const onScreen: [number, number] = [cover.x + (px0 / pic.w) * cover.width, cover.y + (py0 / pic.h) * cover.height];
      const [lx, ly] = px(live.camera, p, w, h);
      expect(Math.abs(lx - onScreen[0])).toBeLessThan(0.1);
      expect(Math.abs(ly - onScreen[1])).toBeLessThan(0.1);
    }
  });

  it('the set’s recorded cameras are the ones this framing gives (re-render the pictures when it moves)', () => {
    set.posters.forEach((b, i) => {
      if (!b.view) return;
      const v = viewOf(pictureCamera(i).stage);
      expect(Math.hypot(v.focus[0] - b.view.focus[0], v.focus[1] - b.view.focus[1], v.focus[2] - b.view.focus[2]), `band ${i}`).toBeLessThan(1e-3);
      expect(Math.abs(v.distance - b.view.distance)).toBeLessThan(1e-3);
    });
  });

  it('around 1.9:1, a view cut to with hold stays exactly where the picture was taken, until the visitor moves it', () => {
    // the rig clamped an adopted view into a pan range that, at 1.84-1.96:1, excludes it: up to 23 px off
    const i = set.posters.length - 1;
    const view = viewOf(pictureCamera(i).stage);
    for (const w of [1660, 1700, 1750, 1800, 1850, 1900, 1950, 2000]) {
      const live = fakeStage(w, 900);
      frameVignette(live, w, 900);
      const rig = live.camera;
      rig.cutTo({ focus: view.focus, zoom: rig.zoomForDistance(view.distance) }, { hold: true });
      rig.update(0.5);
      const got = viewOf(live);
      const err = Math.hypot(got.focus[0] - view.focus[0], got.focus[1] - view.focus[1], got.focus[2] - view.focus[2]) + Math.abs(got.distance - view.distance);
      const pxPerUnit = 900 / (2 * Math.tan((rig.fov * Math.PI) / 360) * rig.distance);
      expect(err * pxPerUnit, `${w}×900`).toBeLessThan(0.1);
      // a pan lets go of the hold: the limits apply again
      rig.panBy(0, 0);
      for (let k = 0; k < 30; k++) rig.update(0.1);
      expect(rig.stretched).toBe(false);
    }
  });
});

describe('progress and state', () => {
  it('warmth starts dim, only rises, and is exactly 1 when loaded', () => {
    expect(warmth(0)).toBeCloseTo(0.42, 9);
    let last = 0;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const w = warmth(p);
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
    expect(warmth(1)).toBe(1);
    expect(warmth(2)).toBe(1);
  });

  it('progress is monotone and reaches 1 when every phase is done', () => {
    const p = new Progress();
    expect(p.report('views', 1, 4)).toBeGreaterThan(0);
    const a = p.current;
    expect(p.report('views', 0, 4)).toBe(a); // never goes back
    for (const k of Object.keys(PHASE_WEIGHTS)) p.report(k, 1);
    expect(p.current).toBeCloseTo(1, 12);
  });

  it('the picture’s state is reached by the same calls every time', () => {
    const calls: number[] = [];
    stepToPicture({ advance: (n: number) => void calls.push(n) } as never, { step: 12, settle: 2 });
    expect(calls).toEqual([12, 0, 0]);
  });
});
