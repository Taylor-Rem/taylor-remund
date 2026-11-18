/**
 * Fetch, the runner (crew; § B5), drawn at the crew's scale about its own origin (under the tyre). After
 * the parts: it re-seats the carried crate in its claws.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Frame, StationViewFactory } from '../../types.ts';
import { createFetchView } from '../../stations/fetch.ts';
import { ORDER, type BenchStation } from '../station.ts';

/** Fetch drawn `s`× about its own origin; the crate in its hands is moved out to where the bigger hands are. */
function scaledFetch(inner: StationViewFactory, s: number): StationViewFactory {
  return (ctx) => {
    const v = inner(ctx);
    const body = v.root.getObjectByName('fetch:body');
    const S = new Matrix4().makeScale(s, s, s);
    const M = new Matrix4(), Bi = new Matrix4();
    const p = new Vector3(), q = new Quaternion(), k = new Vector3();
    return {
      root: v.root,
      update(frame: Frame) {
        v.update(frame);
        if (!body || !body.visible) return;
        const B = body.matrix;
        const w = frame.world;
        const c = w.crew(w.scene.runner.id);
        if (c?.carrying && w.mode(c.carrying) === 'crew') {
          const o = ctx.scene.getObjectByName(`part:${c.carrying}`);
          if (o) {
            M.copy(B).multiply(S).multiply(Bi.copy(B).invert());
            o.matrix.decompose(p, q, k);
            o.matrix.compose(p.applyMatrix4(M), q, k);
            o.matrixWorldNeedsUpdate = true;
          }
        }
        B.multiply(S);
        body.matrixWorldNeedsUpdate = true;
      },
      dispose: () => v.dispose(),
    };
  };
}

export const station: BenchStation = {
  name: 'fetch',
  order: ORDER.crew + 2,
  make(k) {
    return scaledFetch(createFetchView({ seed: 7 }), k.crewScale);
  },
};
