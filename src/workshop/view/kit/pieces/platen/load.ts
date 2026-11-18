/**
 * Something on the tray, for review pictures only (the brief: "show it with a
 * crate on the tray and with a stand-in robot", 1.6 tall and 1.25 wide since the crew may be drawn up to 1.5x): an L crate, flattened
 * into the tray's `load` node, or a plain stand-in for Fetch at its P2 size (a
 * fat tyre in a fork under a round head, 1.6 tall and 1.25 wide). The view never uses
 * these: on the bench the real crate and the real Fetch ride the `seat` socket.
 */
import { Matrix4 } from 'three';
import type { KitPart, PieceNode } from '../../types.ts';
import type { Token } from '../../../palette.ts';
import { lathe, roundedBox, squircle } from '../../solids.ts';
import { profile } from '../../profile.ts';
import { part, T } from '../../compose.ts';
import { transform } from '../../deform.ts';
import { setFinish } from '../../space.ts';
import { crate } from '../crate/index.ts';

export type Load = 'crate' | 'robot';

/** The stand-in robot's size: the crew may be drawn up to 1.5x this phase (the lead, 2026-11-18): 1.6 tall, 1.25 wide. */
export const ROBOT_H = 1.6;
export const ROBOT_W = 1.25;

/** The parts of a load, standing on y = 0 at the seat. */
export function loadParts(load: Load, o: { seed: number; stencil?: boolean; paint?: Token | null }): KitPart[] {
  if (load === 'crate') {
    const c = crate({ size: 'L', seed: o.seed + 7, stencil: o.stencil ?? false, paint: o.paint ?? null });
    const out: KitPart[] = [];
    const walk = (n: PieceNode, parent: Matrix4): void => {
      const w = parent.clone().multiply(n.transform ?? new Matrix4());
      for (const q of n.parts) out.push({ ...q, geometry: transform(q.geometry.clone(), w) });
      for (const ch of n.children ?? []) walk(ch, w);
    };
    walk(c.root, new Matrix4());
    return out;
  }
  // the stand-in: a tyre, a fork, a round head with one eye. Clay-simple on purpose.
  const tyreR = 0.3, tyreW = 0.24;
  const tyre = lathe(profile(0, -tyreW / 2).to(tyreR - 0.05, -tyreW / 2, { sharp: true }).to(tyreR, -tyreW / 2 + 0.03, { fillet: 0.05, segs: 3 }).to(tyreR, tyreW / 2 - 0.03, { smooth: true }).to(tyreR - 0.05, tyreW / 2, { fillet: 0.05, segs: 3 }).to(0, tyreW / 2), { segs: 20, band: 0 });
  transform(tyre, new Matrix4().makeTranslation(0, tyreR, 0).multiply(new Matrix4().makeRotationX(Math.PI / 2)));
  const fork = roundedBox({ w: 0.44, h: 0.36, d: 0.34, r: 0.07, band: 0 });
  transform(fork, T(0, tyreR + 0.12, 0));
  const headH = ROBOT_H - (tyreR + 0.42);
  const head = squircle({ w: ROBOT_W, h: headH, d: 0.95, band: 0 });
  head.computeBoundingBox();
  const bb = head.boundingBox!;
  transform(head, T(0, tyreR + 0.42 - bb.min.y, 0));
  const eye = lathe(profile(0, 0).to(0.24, 0, { sharp: true }).to(0.24, 0.05, { fillet: 0.02, segs: 2 }).to(0, 0.06), { segs: 18, band: 0 });
  transform(eye, T(0, tyreR + 0.42 + headH * 0.55, 0.45).multiply(new Matrix4().makeRotationX(Math.PI / 2)));
  return [
    part('rubber', tyre, 'ink'),
    part('steel', fork, 'teal-panel'),
    part('steel', head, 'paper', { shade: 0.9 }),
    setFinish(part('brass', eye, 'brass'), 0.6),
  ];
}
