// probe-rattle (T1): does each station's rattling part move, and by how much on screen? Forces the second tell
// (patching `tells().last` on this page's world only), steps through the rattle, and reports per station the part's
// largest turn (degrees) and how far its world position moved, projected to CSS px. Full motion.
//   node scripts/probe-rattle.ts [--origin http://localhost:4347] [--w 1440 --h 900] [--mobile]
import { parseArgs } from 'node:util';
import { openPage } from './capture.ts';

const { values: v } = parseArgs({ options: { origin: { type: 'string', default: 'http://localhost:4347' }, w: { type: 'string', default: '1440' }, h: { type: 'string', default: '900' }, mobile: { type: 'boolean' } } });
const PARTS: Record<string, [string, string]> = {
  'undo-lever': ['undo-station', 'latch'],
  striker: ['striker', 'arm'],
  cord: ['switchboard', 'plug'],
  belt: ['belt', 'lever'],
  dock: ['dock', 'flap'],
  chute: ['chute', 'chute.hinge'],
  lamp: ['lamp', 'head'],
  line: ['phone', 'phone'],
  platen: ['platen', 'tray'],
  storefront: ['storefront', 'opensign'],
};
const s = await openPage(`${v.origin}/dev/bench/?manual=1&hud=0&names=0`, { w: Number(v.w), h: Number(v.h), mobile: !!v.mobile, readyTimeout: 90_000 });
const out = await s.page.evaluate((PARTS) => {
  type O = { name: string; children: O[]; getObjectByName(n: string): O | undefined; quaternion: { angleTo(q: unknown): number; clone(): unknown }; updateWorldMatrix(a: boolean, b: boolean): void; matrixWorld: { elements: number[] } };
  const b = (window as unknown as { __bench: { ws: { world: { step: number; tells(): { last: unknown }; interactable(id: string): { tell(): void } | undefined }; advance(n: number): void; stage: { scene: O; camera: { worldToScreen(p: { x: number; y: number; z: number }): { x: number; y: number } } } } } }).__bench;
  b.ws.advance(240);
  const w = b.ws.world;
  const real = w.tells.bind(w);
  const res: Record<string, string> = {};
  for (const [id, [root, node]] of Object.entries(PARTS)) {
    let r: O | undefined;
    for (const c of b.ws.stage.scene.children) if (c.name === root) r = c;
    const n = r?.getObjectByName(node);
    if (!n) {
      res[id] = 'part not found';
      continue;
    }
    const px = (): [number, number] => {
      n.updateWorldMatrix(true, false);
      const e = n.matrixWorld.elements;
      const p = b.ws.stage.camera.worldToScreen({ x: e[12]!, y: e[13]!, z: e[14]! });
      return [((p.x + 1) / 2) * innerWidth, ((1 - p.y) / 2) * innerHeight];
    };
    b.ws.advance(1);
    const q0 = n.quaternion.clone();
    const p0 = px();
    w.interactable(id)?.tell();
    const at = w.step;
    w.tells = () => ({ ...(real() as object), last: { id, step: at, times: 2 } });
    let deg = 0, move = 0;
    for (let k = 0; k < 60; k++) {
      b.ws.advance(1);
      deg = Math.max(deg, (n.quaternion.angleTo(q0) * 180) / Math.PI);
      const p = px();
      move = Math.max(move, Math.hypot(p[0] - p0[0], p[1] - p0[1]));
    }
    b.ws.advance(30);
    const after = (n.quaternion.angleTo(q0) * 180) / Math.PI;
    res[id] = `turned up to ${deg.toFixed(2)}°, its origin moved up to ${move.toFixed(1)} px; ${after.toFixed(3)}° off its start after`;
    w.tells = real;
    b.ws.advance(60 * 9);
  }
  return res;
}, PARTS);
for (const [k, r] of Object.entries(out)) console.log(`${k}: ${r}`);
await s.close();
