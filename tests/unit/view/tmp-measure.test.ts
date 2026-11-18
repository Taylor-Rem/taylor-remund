import { it } from 'vitest';
import { Vector3 } from 'three';
import { pieceBounds } from '../../../src/workshop/view/kit/compose.ts';
import { belt } from '../../../src/workshop/view/kit/pieces/belt/index.ts';

const r = (v: number) => Math.round(v * 1000) / 1000;
it('m', () => {
  for (const line of [false, true]) {
    const p = belt({ detail: 'low', length: 10, line } as never);
    const b = pieceBounds(p);
    console.log('belt line', line, 'x', r(b.min.x), r(b.max.x), 'y', r(b.max.y), 'z', r(b.min.z), r(b.max.z), 'tris', p.triangles);
    for (const [k, m] of Object.entries(p.sockets ?? {})) {
      const v = new Vector3().setFromMatrixPosition(m);
      console.log('   ', k, r(v.x), r(v.y), r(v.z));
    }
  }
});
