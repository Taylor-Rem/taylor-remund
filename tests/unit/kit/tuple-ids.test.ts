// F1: the shadow proxies' welds and clustering key cells by numbers (TupleIds) instead of text. The proxies
// must come out exactly as they did with the text keys: these hold the new code against the old, kept here.
import { describe, expect, it } from 'vitest';
import { cluster, lumpsOf, TupleIds } from '../../../src/workshop/view/kit/realize.ts';
import { catalogue as porterCat } from '../../../src/workshop/view/kit/pieces/fetch-porter/index.ts';
import { catalogue as buttonCat } from '../../../src/workshop/view/kit/pieces/button/index.ts';
import { rng } from '../../../src/workshop/view/kit/rng.ts';
import type { Piece, PieceNode } from '../../../src/workshop/view/kit/types.ts';

/** The text-keyed weld of lumpsOf before F1. */
function weldByText(pos: ArrayLike<number>): Int32Array {
  const n = pos.length / 3;
  const q = 1e4;
  const weld = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3]! * q)},${Math.round(pos[i * 3 + 1]! * q)},${Math.round(pos[i * 3 + 2]! * q)}`;
    const w = seen.get(k);
    if (w === undefined) {
      seen.set(k, i);
      weld[i] = i;
    } else weld[i] = w;
  }
  return weld;
}

/** `cluster` before F1 (text keys for the cells and for the repeated triangles). */
function clusterByText(pos: readonly number[], bones: readonly number[], cell: number): { pos: number[]; bones: number[] } {
  const n = pos.length / 3;
  const keyOf: string[] = [];
  for (let i = 0; i < n; i++) keyOf.push(`${bones[i]!}:${Math.floor(pos[i * 3]! / cell)},${Math.floor(pos[i * 3 + 1]! / cell)},${Math.floor(pos[i * 3 + 2]! / cell)}`);
  const sum = new Map<string, [number, number, number, number]>();
  for (let i = 0; i < n; i++) {
    const s = sum.get(keyOf[i]!);
    if (s) {
      s[0] += pos[i * 3]!;
      s[1] += pos[i * 3 + 1]!;
      s[2] += pos[i * 3 + 2]!;
      s[3]++;
    } else sum.set(keyOf[i]!, [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!, 1]);
  }
  const outPos: number[] = [];
  const outBones: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < n / 3; t++) {
    const a = keyOf[t * 3]!, b = keyOf[t * 3 + 1]!, c = keyOf[t * 3 + 2]!;
    if (a === b || b === c || a === c) continue;
    const tri = a < b && a < c ? `${a}|${b}|${c}` : b < c ? `${b}|${c}|${a}` : `${c}|${a}|${b}`;
    if (seen.has(tri)) continue;
    seen.add(tri);
    for (const k of [a, b, c]) {
      const s = sum.get(k)!;
      outPos.push(s[0] / s[3], s[1] / s[3], s[2] / s[3]);
    }
    outBones.push(bones[t * 3]!, bones[t * 3 + 1]!, bones[t * 3 + 2]!);
  }
  return { pos: outPos, bones: outBones };
}

/** Non-indexed positions of a realised piece's parts (what a proxy is built from). */
function soup(build: () => Piece): { pos: number[]; bones: number[] } {
  const nodes: PieceNode[] = [];
  const walk = (n: PieceNode): void => {
    nodes.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(build().root);
  const pos: number[] = [];
  const bones: number[] = [];
  nodes.forEach((node, b) => {
    for (const part of node.parts) {
      const p = part.geometry.getAttribute('position');
      const idx = part.geometry.index;
      const n = idx ? idx.count : p.count;
      for (let k = 0; k < n; k++) {
        const i = idx ? idx.getX(k) : k;
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        bones.push(b % 3);
      }
    }
  });
  return { pos, bones };
}

describe('TupleIds', () => {
  it('gives the ids a Map keyed by the tuple text gives, first seen first', () => {
    const r = rng(7);
    const ids = new TupleIds(5, 8);
    const text = new Map<string, number>();
    for (let i = 0; i < 20000; i++) {
      const pick = (): number => {
        const u = r();
        return u < 0.1 ? -0 : u < 0.2 ? 0 : u < 0.3 ? Math.round((r() - 0.5) * 1e9) : Math.round((r() - 0.5) * 40);
      };
      const t = [pick(), pick(), pick(), pick(), pick()] as const;
      const k = t.join(',');
      let want = text.get(k);
      if (want === undefined) text.set(k, (want = text.size));
      expect(ids.id(...t)).toBe(want);
      expect(ids.size).toBe(text.size);
    }
  });
});

describe('the proxies keyed by numbers are the proxies keyed by text', () => {
  for (const [name, build] of [['fetch-porter', () => porterCat[0]!.build()], ['button', () => buttonCat[0]!.build()]] as const) {
    it(`${name}: the weld of lumpsOf, bit for bit`, () => {
      const { pos } = soup(build);
      expect(pos.length).toBeGreaterThan(9000);
      const l = lumpsOf(pos, null);
      // same lumps as the text weld makes: rebuild them from the old weld and compare triangle by triangle
      const old = weldByText(pos);
      const root = new Map<number, number>();
      const lumpOfOld: number[] = [];
      // union-find over the old weld, as lumpsOf does
      const parent = Int32Array.from({ length: pos.length / 3 }, (_, i) => i);
      const find = (a: number): number => {
        while (parent[a] !== a) a = parent[a] = parent[parent[a]!]!;
        return a;
      };
      for (let t = 0; t < pos.length / 9; t++) {
        const a = find(old[t * 3]!);
        for (const c of [1, 2]) {
          const b = find(old[t * 3 + c]!);
          if (a !== b) parent[b] = a;
        }
      }
      for (let t = 0; t < pos.length / 9; t++) {
        const r = find(old[t * 3]!);
        if (!root.has(r)) root.set(r, root.size);
        lumpOfOld.push(root.get(r)!);
      }
      expect(Array.from(l.of)).toEqual(lumpOfOld);
    });
    it(`${name}: cluster, bit for bit`, () => {
      const { pos, bones } = soup(build);
      expect(pos.length).toBeGreaterThan(9000);
      for (const cell of [0.016, 0.05]) {
        const a = cluster(pos, bones, cell);
        const b = clusterByText(pos, bones, cell);
        expect(a.pos.length).toBe(b.pos.length);
        expect(Float64Array.from(a.pos)).toEqual(Float64Array.from(b.pos));
        expect(a.bones).toEqual(b.bones);
      }
    });
  }
});
