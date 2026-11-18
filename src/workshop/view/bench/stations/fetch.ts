/**
 * Fetch, the runner (crew; § B5), drawn at the crew's scale about its own origin (under the tyre). The
 * simulation sizes Fetch's body and hands by the scene's `crewScale`, so the crate it carries is already
 * where the bigger hands are: only the drawing is scaled here.
 */
import { Matrix4 } from 'three';
import type { Frame, StationViewFactory } from '../../types.ts';
import { createFetchView } from '../../stations/fetch.ts';
import { ORDER, type BenchStation } from '../station.ts';

function scaledFetch(inner: StationViewFactory, s: number): StationViewFactory {
  return (ctx) => {
    const v = inner(ctx);
    const body = v.root.getObjectByName('fetch:body');
    const S = new Matrix4().makeScale(s, s, s);
    return {
      root: v.root,
      update(frame: Frame) {
        v.update(frame);
        if (!body || !body.visible) return;
        body.matrix.multiply(S);
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
    return scaledFetch(createFetchView({ seed: 7, scale: k.crewScale }), k.crewScale);
  },
};
