// The bench's picture-first start (B1 round 2): its aspect bands follow its own framing
// (view/bench.ts homeBox/homeEdge: the phone box under 1, the wide box to 1.7, the wider box above),
// and the live camera adopting a band's picture sees it exactly at every aspect of the band.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { coverRect, makeBands, picturePreloads, pixelSize, type PosterSet } from '../../../src/workshop/shell/poster.ts';
import { adoptView, bandView, viewOf } from '../../../src/workshop/shell/loader.ts';
import { CameraRig } from '../../../src/workshop/view/stage/camera.ts';
import type { Stage } from '../../../src/workshop/view/stage/index.ts';
import { FRAMING, homeBox, homeEdge } from '../../../src/workshop/view/bench.ts';
import { bench } from '../../../src/workshop/sim/scenes/bench.ts';

const SET_PATH = join(process.cwd(), 'src/dev-pages/bench/posters.json');
const set = JSON.parse(readFileSync(SET_PATH, 'utf8')) as PosterSet;

function fakeStage(w: number, h: number): Stage {
  const rig = new CameraRig({ ...FRAMING.lens });
  rig.setAspect(w / h);
  return { camera: rig, renderer: { domElement: { clientWidth: w, clientHeight: h, width: w, height: h } } } as unknown as Stage;
}
/** The page's framing (src/dev-pages/bench.astro frameCamera, not the plan view). */
function frameBench(stage: Stage, w: number, h: number): void {
  const aspect = w < h ? 0.5 : w / h;
  stage.camera.stationSize = 1.9;
  stage.camera.setSubject(homeBox(aspect), { edge: homeEdge(aspect, bench.bench), bounds: new Box3(new Vector3(...FRAMING.bounds.min), new Vector3(...FRAMING.bounds.max)) });
  stage.camera.cutTo(stage.camera.home());
}
function pictureCamera(i: number): { stage: Stage; w: number; h: number } {
  const b = set.posters[i]!;
  const { width: w, height: h } = pixelSize(b);
  const stage = fakeStage(w, h);
  frameBench(stage, w, h);
  bandView(stage, i === 0 ? set.narrowest : b.minAspect);
  return { stage, w, h };
}
function px(rig: CameraRig, p: Vector3, w: number, h: number): [number, number] {
  rig.camera.updateMatrixWorld(true);
  const v = p.clone().project(rig.camera);
  return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
}

describe('the bench’s bands', () => {
  it('follow its framing: split at 1 and at the wider box (1.7), one band above', () => {
    const b = makeBands({ narrowest: 0.42, wideFrom: 1.701, widest: 2.4, ratio: 1.14, breaks: [FRAMING.widerFrom], height: { portrait: 900, landscape: 1080 }, densities: { portrait: [1, 2], landscape: [1] } });
    expect(b.map((x) => [x.minAspect, x.aspect])).toEqual(set.posters.map((x) => [x.minAspect, x.aspect]));
    // no band straddles a switch of the framing
    for (const x of b) {
      for (const cut of [1, FRAMING.widerFrom]) expect(x.minAspect < cut && x.aspect > cut, `${x.minAspect}..${x.aspect}`).toBe(false);
    }
  });

  it('one picture preload per band, and exactly one matches any aspect', () => {
    const links = picturePreloads(set, (f) => `/x/${f}`);
    if (!set.posters.some((p) => p.files.length)) return;
    expect(links.length).toBe(set.posters.length);
    const parse = (m: string): [number, number] => {
      const lo = /min-aspect-ratio: (\d+)\/(\d+)/.exec(m);
      const hi = /max-aspect-ratio: (\d+)\/(\d+)/.exec(m);
      return [lo ? Number(lo[1]) / Number(lo[2]) : 0, hi ? Number(hi[1]) / Number(hi[2]) : Infinity];
    };
    for (const a of [0.43, 0.46, 0.5, 0.75, 0.999, 1, 1.333, 1.5, 1.6, 1.7, 1.78, 2.33]) {
      expect(links.filter((l) => { const [lo, hi] = parse(l.media); return a >= lo && a <= hi; }).length, `aspect ${a}`).toBe(1);
    }
  });

  it('the files the set lists exist', () => {
    for (const f of set.posters.flatMap((p) => p.files)) expect(existsSync(join(dirname(SET_PATH), f.file)), f.file).toBe(true);
  });

  const cases: [number, number, number][] = [];
  set.posters.forEach((b, i) => {
    const lo = Math.max(b.minAspect, set.narrowest);
    for (const t of [0, 0.5, 1]) {
      const a = lo + (b.aspect - lo) * t;
      cases.push([i, t === 0 ? Math.ceil(a * 900) : Math.floor(a * 900), 900]);
    }
  });
  cases.push([set.posters.length - 1, 1920, 1080], [set.posters.length - 1, 1280, 720], [set.posters.length - 2, 1440, 900], [0, 390, 844]);

  it.each(cases)('band %i on a %i×%i screen: every point on the same pixel as in the picture', (i, w, h) => {
    const pic = pictureCamera(i);
    const live = fakeStage(w, h);
    frameBench(live, w, h);
    adoptView(live, viewOf(pic.stage));
    const cover = coverRect(pic.w / pic.h, w, h);
    const pts = [new Vector3(-9, 0, 5), new Vector3(9, 0, 5), new Vector3(0, 0.6, 1.2), new Vector3(-9, 4.4, -4.9), new Vector3(8.8, 5.2, -4.6), new Vector3(2, 1.2, -2)];
    for (const p of pts) {
      const [x0, y0] = px(pic.stage.camera, p, pic.w, pic.h);
      const [lx, ly] = px(live.camera, p, w, h);
      expect(Math.abs(lx - (cover.x + (x0 / pic.w) * cover.width))).toBeLessThan(0.1);
      expect(Math.abs(ly - (cover.y + (y0 / pic.h) * cover.height))).toBeLessThan(0.1);
    }
  });

  it('the set’s recorded cameras are the ones this framing gives (re-render the pictures when it moves)', () => {
    set.posters.forEach((b, i) => {
      if (!b.view) return;
      const v = viewOf(pictureCamera(i).stage);
      expect(Math.hypot(v.focus[0] - b.view.focus[0], v.focus[1] - b.view.focus[1], v.focus[2] - b.view.focus[2]), `band ${i}`).toBeLessThan(1e-3);
      expect(Math.abs(v.distance - b.view.distance), `band ${i}`).toBeLessThan(1e-3);
    });
  });
});
