import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, Vector3 } from 'three';
import type { Material } from 'three';
import * as K from '../../../src/workshop/view/kit/index.ts';
import type { Materials } from '../../../src/workshop/view/types.ts';
import type { PieceNode } from '../../../src/workshop/view/kit/types.ts';
import { cardArm, catalogue, poseCardArm, stowDepth, NAMED_POSES, CARD_ARM } from '../../../src/workshop/view/kit/pieces/card-arm/index.ts';
import { checkGeometry } from './helpers.ts';

const BUDGET = 4500;
const stub: Materials = { of: (): Material => new MeshBasicMaterial(), textured: (): Material => new MeshBasicMaterial(), update() {}, dispose() {} };

const names = (n: PieceNode, out: string[] = []): string[] => {
  out.push(n.name);
  for (const c of n.children ?? []) names(c, out);
  return out;
};

describe('the card arm', () => {
  const p = cardArm();

  it('builds deterministically, inside its budget, with valid geometry', () => {
    expect(cardArm().triangles).toBe(p.triangles);
    expect(p.triangles).toBeLessThan(BUDGET);
    const walk = (n: PieceNode): void => {
      for (const q of n.parts) checkGeometry(q.geometry);
      for (const c of n.children ?? []) walk(c);
    };
    walk(p.root);
  });

  it('has the moving nodes and sockets the view poses', () => {
    expect(names(p.root)).toEqual(expect.arrayContaining(['arm', 'card']));
    expect(p.sockets?.['card']).toBeDefined();
    expect(p.sockets?.['slot']).toBeDefined();
  });

  it('takes its card texture on the face only', () => {
    const q = cardArm({ card: { key: 'card:x', w: 2.4, h: 1.4 } });
    const textured: string[] = [];
    const walk = (n: PieceNode): void => {
      for (const part of n.parts) if (part.texture) textured.push(`${n.name}:${part.material}:${part.texture}`);
      for (const c of n.children ?? []) walk(c);
    };
    walk(q.root);
    expect(textured).toEqual(['card:paper:card:x']);
  });

  it('stows everything below the bench top and raises the card clear above it', () => {
    const h = CARD_ARM.cardEstimate.h;
    const o = K.realize(p, stub);
    poseCardArm(o, { lift: 0, lean: 0, flap: 0 }, stowDepth(h));
    o.updateMatrixWorld(true);
    const card = o.getObjectByName('card')!;
    const top = new Vector3(0, h, 0).applyMatrix4(card.matrixWorld);
    expect(top.y).toBeLessThan(0);
    expect(o.getObjectByName('arm')!.visible).toBe(false);
    poseCardArm(o, { lift: 1 }, stowDepth(h));
    o.updateMatrixWorld(true);
    const bottom = new Vector3(0, 0, 0).applyMatrix4(card.matrixWorld);
    expect(bottom.y).toBeGreaterThan(1.2);
    expect(o.getObjectByName('arm')!.visible).toBe(true);
  });

  it('leans the raised card back toward the camera', () => {
    const o = K.realize(p, stub);
    poseCardArm(o, {}, stowDepth(CARD_ARM.cardEstimate.h));
    o.updateMatrixWorld(true);
    const n = new Vector3(0, 0, 1).transformDirection(o.getObjectByName('card')!.matrixWorld);
    expect(n.y).toBeGreaterThan(0.2); // facing up toward a camera above the bench
    expect(n.z).toBeGreaterThan(0.8);
  });

  it('has a catalogue entry with every named pose', () => {
    const e = catalogue[0]!;
    expect(e.name).toBe('card-arm');
    for (const pose of Object.keys(NAMED_POSES)) expect(e.build({ pose }).triangles).toBeGreaterThan(0);
  });
});
