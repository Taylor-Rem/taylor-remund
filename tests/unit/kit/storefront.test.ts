import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three';
import type { Material } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { paints, linear } from '../../../src/workshop/view/palette.ts';
import {
  storefront, catalogue, poseStorefront, nodeMatrices, NAMED_POSES, REST, HIDDEN, slatTurn, wordsFace, awningGeometry,
  fasciaColour, awningColour, openClosed, pictureRoll, hiddenFace, awningCycle, lightStutter, paintFascia, wipeFascia,
  fitWords, cleanWords, MAX_CHARS, PICTURES, pictureIndex, NODES, SHOP,
} from '../../../src/workshop/view/kit/pieces/storefront/index.ts';
import { slatUv, ATLAS } from '../../../src/workshop/view/kit/pieces/storefront/atlas.ts';
import { checkGeometry } from './helpers.ts';
import texts from '../../../src/content/texts.json';

const CAP = 9000;
const stub: Materials = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial({ map: null }), update() {}, dispose() {} };

function nodes(p: Piece): Map<string, PieceNode> {
  const out = new Map<string, PieceNode>();
  const walk = (n: PieceNode): void => {
    out.set(n.name, n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(p.root);
  return out;
}

describe('the storefront', () => {
  const p = storefront();

  it('builds deterministically; another seed is another shop', () => {
    const a = storefront({ seed: 3 }), b = storefront({ seed: 3 });
    expect(a.triangles).toBe(b.triangles);
    expect(a.root.parts[0]!.geometry.getAttribute('position').array).toEqual(b.root.parts[0]!.geometry.getAttribute('position').array);
    const c = storefront({ seed: 4 });
    const pa = a.root.parts.map((q) => q.geometry.getAttribute('position').array);
    const pc = c.root.parts.map((q) => q.geometry.getAttribute('position').array);
    expect(pc).not.toEqual(pa);
  });

  it('fits its triangle cap and draws in few calls', () => {
    const b = K.budget(p, CAP);
    expect(b.fits, b.text).toBe(true);
    expect(storefront({ detail: 'low' }).triangles).toBeLessThan(p.triangles);
    // a moving piece: one skinned mesh per class (+ textured parts), about twice that with shadows
    expect(b.calls).toBeLessThanOrEqual(24);
  });

  it('is the brief size: about 2.3 wide, 2.1 tall at the cornice, 0.9 deep, standing on y = 0', () => {
    const box = K.pieceBounds(p);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(SHOP.w).toBeCloseTo(2.3, 5);
    expect(box.max.x - box.min.x).toBeGreaterThan(2.2);
    // the jack box stands beside it on the left, its conduit running off toward the switchboard
    expect(box.max.x - box.min.x).toBeLessThan(3.6);
    expect(box.max.z - box.min.z).toBeLessThan(1.25);
    expect(box.max.y).toBeLessThan(2.9);
  });

  it('every geometry holds the kit invariants', () => {
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('has every node a view moves, each with its pivot set', () => {
    const n = nodes(p);
    const want = [NODES.slat(0), NODES.slat(3), NODES.awning, NODES.awningColour, NODES.valance, NODES.valanceColour, NODES.armL, NODES.armR, NODES.crank, NODES.openSign, NODES.windowLit, NODES.windowUnlit, NODES.drum, NODES.lampLit, NODES.lampUnlit];
    for (const w of want) expect(n.has(w), w).toBe(true);
    expect(p.sockets?.['jack']).toBeDefined();
    expect(p.sockets?.['words']).toBeDefined();
  });

  it('builds at its bind pose: nothing collapsed (so a view can pose any way without precision loss)', () => {
    const m = nodeMatrices({}, true);
    const s = new Vector3();
    for (const [name, mat] of m) {
      mat.decompose(new Vector3(), new Quaternion(), s);
      if (name !== NODES.awning) expect(Math.min(s.x, s.y, s.z), name).toBeGreaterThan(0.9);
    }
  });
});

describe('posing', () => {
  const p = storefront();
  const realized = (): Object3D => K.realize(storefront(), stub);

  it('poses only what is named', () => {
    const o = realized();
    poseStorefront(o, REST);
    const slat = o.getObjectByName(NODES.slat(2))!;
    const q0 = slat.quaternion.clone();
    poseStorefront(o, { awning: 0.3 });
    expect(slat.quaternion.equals(q0)).toBe(true);
    expect(o.getObjectByName(NODES.armL)!.quaternion.angleTo(new Quaternion())).toBeCloseTo(awningGeometry(0.3).phi, 4);
  });

  it('runs the same backwards: a pose depends only on its numbers', () => {
    const o = realized();
    poseStorefront(o, { words: 0.37, awning: 0.62, open: 0.4, picture: 2.3 });
    const snap = (x: Object3D): number[] => [NODES.slat(1), NODES.awning, NODES.openSign, NODES.drum].flatMap((n) => x.getObjectByName(n)!.matrix.compose(x.getObjectByName(n)!.position, x.getObjectByName(n)!.quaternion, x.getObjectByName(n)!.scale).elements.slice());
    const a = snap(o);
    poseStorefront(o, { words: 1, awning: 0, open: 0, picture: 4 });
    poseStorefront(o, { words: 0.37, awning: 0.62, open: 0.4, picture: 2.3 });
    expect(snap(o).map((v) => Math.round(v * 1e6))).toEqual(a.map((v) => Math.round(v * 1e6)));
  });

  it('turns the slats one after another from the top, and lands on the other face', () => {
    expect(slatTurn(0, 2)).toBe(0);
    expect(slatTurn(1, 0)).toBe(1);
    expect(slatTurn(0.3, 3)).toBeGreaterThan(slatTurn(0.3, 0));
    expect(wordsFace(0)).toBe('A');
    expect(wordsFace(1)).toBe('B');
    expect(wordsFace(2)).toBe('A');
    expect(hiddenFace(0)).toBe('B');
    expect(hiddenFace(1)).toBe('A');
  });

  it('swaps lit and unlit by scale, and the station lamp', () => {
    const o = realized();
    poseStorefront(o, { open: 0 });
    expect(o.getObjectByName(NODES.windowLit)!.scale.x).toBeCloseTo(HIDDEN, 6);
    expect(o.getObjectByName(NODES.windowUnlit)!.scale.x).toBe(1);
    poseStorefront(o, { open: 1 });
    expect(o.getObjectByName(NODES.windowLit)!.scale.x).toBe(1);
    poseStorefront(o, { lamp: 1 });
    expect(o.getObjectByName(NODES.lampLit)!.scale.x).toBe(1);
    expect(o.getObjectByName(NODES.lampUnlit)!.scale.x).toBeCloseTo(HIDDEN, 6);
  });

  it('awning: rolls in to nothing and out to the full canvas; a colour change rolls in and out again', () => {
    expect(awningGeometry(0).len).toBeLessThan(0.05);
    expect(awningGeometry(1).len).toBeGreaterThan(0.3);
    expect(awningCycle(0)).toBe(1);
    expect(awningCycle(0.5)).toBe(0);
    expect(awningCycle(1)).toBe(1);
  });

  it('the light stutters out: on at the start, off at the end', () => {
    expect(lightStutter(0)).toBe(1);
    expect(lightStutter(1)).toBe(0);
  });

  it('builds in every named pose', () => {
    for (const name of Object.keys(NAMED_POSES)) expect(() => catalogue[0]!.build({ pose: name }), name).not.toThrow();
    expect(p.triangles).toBeGreaterThan(3000);
  });

  it('performs every change on a realized storefront without throwing, forwards and back', () => {
    const o = realized();
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      fasciaColour(o, 'paint-green', 'paint-blue', t);
      awningColour(o, 'cable-red', 'tape-yellow', t);
      openClosed(o, true, false, t);
      openClosed(o, false, true, t);
      pictureRoll(o, 4, 1, t);
    }
  });
});

describe('paint', () => {
  const vertexColours = (o: Object3D, nodeName: string): Array<[number, number, number]> => {
    const out: Array<[number, number, number]> = [];
    o.traverse((x) => {
      const m = x as Mesh;
      if (!m.isMesh) return;
      for (const s of K.sourcesOf(m)) {
        if (s.node !== nodeName) continue;
        const c = m.geometry.getAttribute('color');
        for (let i = s.start; i < s.start + s.count; i++) out.push([c.getX(i), c.getY(i), c.getZ(i)]);
      }
    });
    return out;
  };

  it('repaints the fascia in any of the eight paints, keeping its unevenness, and leaves its twins alone', () => {
    const piece = storefront();
    const a = K.realize(piece, stub), b = K.realize(piece, stub);
    for (const paint of paints) {
      expect(paintFascia(a, paint)).toBeGreaterThan(100);
      const c = vertexColours(a, NODES.slat(1));
      const want = linear(paint);
      const mean = c.reduce((s, v) => s + v[0] + v[1] + v[2], 0) / c.length / (want[0] + want[1] + want[2]);
      expect(mean).toBeGreaterThan(0.85);
      expect(mean).toBeLessThan(1.15);
    }
    const g = linear('paint-green');
    const cb = vertexColours(b, NODES.slat(1));
    expect(cb[0]![1]! / (cb[0]![0]! + 1e-6)).toBeCloseTo(g[1] / g[0], 1);
  });

  it('wipes from left to right', () => {
    const o = K.realize(storefront(), stub);
    wipeFascia(o, 'paint-green', 'paper', 0.5);
    let leftPaper = 0, rightPaper = 0;
    o.traverse((x) => {
      const m = x as Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position'), col = m.geometry.getAttribute('color');
      for (const s of K.sourcesOf(m)) {
        if (!s.node.startsWith('sign.slat')) continue;
        for (let i = s.start; i < s.start + s.count; i++) {
          const isPaper = col.getX(i) > 0.4;
          if (pos.getX(i) < -0.5 && isPaper) leftPaper++;
          if (pos.getX(i) > 0.5 && isPaper) rightPaper++;
        }
      }
    });
    expect(leftPaper).toBeGreaterThan(50);
    expect(rightPaper).toBe(0);
  });
});

describe('the words', () => {
  it('cleans what was typed to what the board can carry', () => {
    expect(cleanWords('  hello   world ')).toBe('HELLO WORLD');
    expect(cleanWords('x'.repeat(30)).length).toBe(MAX_CHARS);
    expect(cleanWords('café ~ ok')).toBe('CAF OK');
  });

  it('every length up to 16 capitals passes the 12 px rule at the default view', () => {
    const samples = ['A', 'SHOP', 'YOUR NAME HERE', 'WWWWWWWWWWWWWWWW', 'MMMMMMMMMMMMMMMM', 'THE BIG RED SHOP', 'I I I I I I I I ', 'ABCDEFGHIJKLMNOP', 'HELLO, WORLD!', '1234567890123456'];
    for (let n = 1; n <= MAX_CHARS; n++) samples.push('W'.repeat(n), 'AB '.repeat(6).slice(0, n));
    for (const s of samples) {
      const l = fitWords(s);
      expect(l.px, `${s}: ${l.lines.join(' / ')} cap ${l.cap.toFixed(3)}`).toBeGreaterThanOrEqual(12);
      expect(l.lines.length).toBeLessThanOrEqual(2);
      expect(l.condense).toBeGreaterThanOrEqual(0.6 - 1e-9);
    }
  });

  it('cuts each slat its own strip of each face', () => {
    const a0 = slatUv('A', 0), a3 = slatUv('A', 3), b0 = slatUv('B', 0);
    expect(a0[1]).toBeCloseTo(0.5, 6);
    expect(a3[3]).toBeCloseTo(1, 2);
    expect(b0[1]).toBeCloseTo(0, 6);
    expect(a0[3]).toBeLessThan(slatUv('A', 1)[1]);
  });
});

describe('the pictures', () => {
  it('are exactly the instruction parser\'s set, plus the empty frame, in its "next" order', () => {
    expect(PICTURES).toEqual(['mountains', 'sun', 'boat', 'tree', 'house', 'none']);
    for (const id of Object.keys((texts as { pictures: Record<string, unknown> }).pictures)) expect(PICTURES).toContain(id);
    expect(pictureIndex('boat')).toBe(2);
    expect(ATLAS.pictures.length).toBe(PICTURES.length);
  });
});

void Group;
