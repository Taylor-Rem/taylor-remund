import { describe, expect, it } from 'vitest';
import * as K from '../../../src/workshop/view/kit/index.ts';
import { dock } from '../../../src/workshop/view/kit/pieces/dock/index.ts';

describe('the dock', () => {
  it('builds', () => {
    const p = dock();
    if (process.env['DOCK_TRIS']) console.warn(K.budget(p, 7000).text, JSON.stringify(p.size), K.budget(p).rows.slice(0, 12).map((r) => `${r.node}:${r.material}:${r.triangles}`).join(' '));
    expect(p.triangles).toBeGreaterThan(0);
  });
});
