// P4 D3 (the lead, after the merge): the report press's glare, swept rather than sampled. A glossy face mirrors the
// lamp's bulb whole from some eye point; one framing can miss it. With the camera where it is (the look, or a station),
// the focus is moved across the press in a grid at that zoom, and at each position the near-white pixels inside the
// press's screen box are counted (a bloom ball is a few hundred; a crisp glint on an edge, a handful).
import type { Page } from '@playwright/test';

export interface SweepCell {
  readonly zoom: number;
  readonly dx: number;
  readonly dz: number;
  readonly white: number;
  readonly at: readonly [number, number] | null;
}

/** Count, at each camera position of the grid, the near-white pixels in the press's screen box. The worst first. */
export async function glareSweep(page: Page, o: { zooms: readonly number[]; nx: number; nz: number; reach: number }): Promise<SweepCell[]> {
  return page.evaluate((o) => {
    const ws = (window as any).__bench.ws;
    const cam = ws.stage.camera;
    const f0 = [cam.focus.x, cam.focus.y, cam.focus.z] as const;
    const z0 = cam.zoom as number;
    const gl = ws.stage.renderer.getContext() as WebGL2RenderingContext;
    const W = ws.stage.canvas.clientWidth, H = ws.stage.canvas.clientHeight;
    const out: { zoom: number; dx: number; dz: number; white: number; at: [number, number] | null }[] = [];
    let px = new Uint8Array(0);
    for (const zoom of o.zooms) {
      for (let j = 0; j < o.nz; j++) {
        for (let i = 0; i < o.nx; i++) {
          const dx = o.nx > 1 ? -o.reach + (2 * o.reach * i) / (o.nx - 1) : 0;
          const dz = o.nz > 1 ? -o.reach + (2 * o.reach * j) / (o.nz - 1) : 0;
          cam.cutTo({ focus: [f0[0] + dx, f0[1], f0[2] + dz], zoom }, { hold: true, close: zoom > 1 });
          ws.advance(0);
          ws.advance(0);
          const b = ws.picking.worldBox('report-press-look');
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (let k = 0; k < 8; k++) {
            const s = cam.worldToScreen({ x: k & 1 ? b.max.x : b.min.x, y: k & 2 ? b.max.y : b.min.y, z: k & 4 ? b.max.z : b.min.z });
            const x = ((s.x + 1) / 2) * W, y = ((1 - s.y) / 2) * H;
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
          const dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight, s = dw / W;
          if (px.length !== dw * dh * 4) px = new Uint8Array(dw * dh * 4);
          gl.readPixels(0, 0, dw, dh, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let n = 0, sx = 0, sy = 0;
          const ya = Math.max(0, Math.floor(y0 * s)), yb = Math.min(dh, Math.ceil(y1 * s));
          const xa = Math.max(0, Math.floor(x0 * s)), xb = Math.min(dw, Math.ceil(x1 * s));
          for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
            const q = ((dh - 1 - y) * dw + x) * 4;
            if (px[q]! >= 250 && px[q + 1]! >= 245 && px[q + 2]! >= 235) { n++; sx += x; sy += y; }
          }
          // CSS px (a device-pixel count over the scale squared)
          out.push({ zoom, dx: Math.round(dx * 100) / 100, dz: Math.round(dz * 100) / 100, white: Math.round(n / (s * s)), at: n ? [Math.round(sx / n / s), Math.round(sy / n / s)] : null });
        }
      }
    }
    cam.cutTo({ focus: [f0[0], f0[1], f0[2]], zoom: z0 }, { hold: true, close: z0 > 1 });
    ws.advance(0);
    return out.sort((a, b) => b.white - a.white);
  }, o);
}
