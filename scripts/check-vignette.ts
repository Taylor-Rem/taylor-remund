// check-vignette: gate G1 part one, the objective checks of the vignette
// (REWRITE.md § G "Gate G1, part one"; W4 brief § C), on the REAL GPU.
//
//   node scripts/check-vignette.ts [url-or-/path] [--json out.json] [--keep-going]
//
// Default target: /dev/vignette/ (a dev server of its own is started).
// 1. Capitals at least 12 px tall at the default view on a 1440-wide screen:
//    the sign, the DO NOT TOUCH tape, the station plates (every label tape
//    in view). Measured by projecting each label quad through the real
//    camera: per triangle, the screen-space derivative of the texture's v
//    coordinate, times the label's cap height as a fraction of its height
//    (labels.capHeight / labels.size). Medians per label.
// 2. Draw calls and triangles of the scene draw, shadow pass included,
//    against § E7 (180, 250,000), at 1440×900 and at 390×844.
// 3. Flicker: two consecutive frames of the still scene (no step, dt 0)
//    must be pixel-identical (z-fighting, shadow acne that crawls, any
//    temporal noise), at the default view and in the close views.
//
// Exit 0 when every check passes, 1 otherwise, 2 on usage.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openPage, resolveTarget, isSoftware } from './capture.ts';
import { isMain } from './lib/cli.ts';
import world from '../src/content/world.json' with { type: 'json' };

export const BUDGET = { calls: 180, triangles: 250_000 } as const;
export const MIN_CAP_PX = 12;

/**
 * Which labels the 12 px rule binds (§ G P1): the sign, the DO NOT TOUCH tape and
 * the station plates: the names that tell a visitor what a station is (the
 * jacks' and the tools' tapes). Taken from the content so nothing is typed here.
 * Everything else (Fetch's own name tag, the counter's PRESSES plate, stencils,
 * cards) is reported, not gated.
 */
const W = world as unknown as {
  sign: { first: { text: string } };
  tape: { doNotTouch: { text: string } };
  jacks: Record<string, { text: string }>;
  tools: Record<string, { text: string }>;
};
const GATED = new Set<string>([
  W.sign.first.text,
  ...W.tape.doNotTouch.text.split(' '),
  W.tape.doNotTouch.text,
  ...Object.values(W.jacks).map((j) => j.text),
  ...Object.values(W.tools).map((t) => t.text),
]);
export function gated(register: string, text: string): boolean {
  if (register !== 'sign' && register !== 'tape' && register !== 'plate') return false;
  // DO NOT TOUCH may be laid as two strips ("DO NOT", "TOUCH")
  return GATED.has(text) || text.split(' ').every((w) => GATED.has(w));
}

interface LabelCap {
  key: string;
  register: string;
  text: string;
  px: number;
  onScreen: boolean;
}
interface Measure {
  labels: LabelCap[];
  scene: { calls: number; triangles: number };
  frame: { calls: number; triangles: number };
  renderer: string;
  width: number;
  height: number;
}
interface Still {
  width: number;
  height: number;
  differing: number;
  maxDelta: number;
  box: number[] | null;
}

export interface Result {
  ok: boolean;
  lines: string[];
  data: Record<string, unknown>;
}

async function run(target: string): Promise<Result> {
  const { url, server } = await resolveTarget(target);
  const lines: string[] = [];
  const data: Record<string, unknown> = {};
  let ok = true;
  const fail = (s: string): void => {
    ok = false;
    lines.push(`FAIL ${s}`);
  };
  const pass = (s: string): void => {
    lines.push(`ok   ${s}`);
  };
  const base = url.includes('?') ? `${url}&` : `${url}?`;
  try {
    // ── 1440×900, the default view ──
    for (const [name, w, h, mobile] of [['wide', 1440, 900, false], ['phone', 390, 844, true]] as const) {
      const s = await openPage(`${base}hud=0&manual=1`, { w, h, dpr: 1, mobile, log: () => {} });
      try {
        if (isSoftware(s.renderer)) fail(`${name}: software renderer (${s.renderer}): numbers are meaningless`);
        const m = (await s.page.evaluate(() => (window as unknown as { __vignette: { measure(): unknown } }).__vignette.measure())) as Measure;
        data[name] = m;
        lines.push(`---- ${name} ${w}×${h}  ${s.renderer}`);
        const { calls, triangles } = m.scene;
        (calls <= BUDGET.calls ? pass : fail)(`${name}: draw calls ${calls} (budget ${BUDGET.calls}, shadow pass included)`);
        (triangles <= BUDGET.triangles ? pass : fail)(`${name}: triangles ${triangles} (budget ${BUDGET.triangles})`);
        if (name === 'wide') {
          const seen = m.labels.filter((l) => l.onScreen);
          const byText = new Map<string, LabelCap>();
          for (const l of seen) {
            const k = `${l.register}|${l.text}`;
            const prev = byText.get(k);
            if (!prev || l.px < prev.px) byText.set(k, l);
          }
          const rows = [...byText.values()].sort((a, b) => a.px - b.px);
          let labelDraws = 0;
          for (const l of seen) labelDraws++;
          for (const l of rows) {
            const line = `${name}: ${l.register.padEnd(7)} ${JSON.stringify(l.text).padEnd(16)} capitals ${l.px.toFixed(1)} px`;
            if (!gated(l.register, l.text)) lines.push(`     ${line} (not gated)`);
            else (l.px >= MIN_CAP_PX ? pass : fail)(`${line} (min ${MIN_CAP_PX})`);
          }
          for (const want of ['sign', 'tape']) if (!rows.some((r) => r.register === want)) fail(`${name}: no ${want} label in view`);
          lines.push(`     ${name}: textured label meshes in view: ${labelDraws}`);
          data['labelDraws'] = labelDraws;
        }
        // ── flicker: the default view, then the close views ──
        for (const shot of name === 'wide' ? ['home', 'button', 'patch', 'cord'] : ['home']) {
          const st = (await s.page.evaluate((sh) => {
            const v = (window as unknown as { __vignette: { shot(n: string): void; stillPair(): unknown } }).__vignette;
            v.shot(sh);
            v.stillPair(); // settle anything the cut started
            return v.stillPair();
          }, shot)) as Still;
          (data[`still-${name}-${shot}`] = st);
          (st.differing === 0 ? pass : fail)(`${name}: still frames at ${shot}: ${st.differing} pixels differ (max Δ ${st.maxDelta})${st.box ? ` in [${st.box.join(', ')}]` : ''}`);
        }
        if (s.errors.length) fail(`${name}: page errors: ${s.errors.slice(0, 3).join(' | ')}`);
      } finally {
        await s.close();
      }
    }
  } finally {
    server?.stop();
  }
  return { ok, lines, data };
}

if (isMain(import.meta.url)) {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'string' } } });
  const target = positionals[0] ?? '/dev/vignette/';
  run(target)
    .then((r) => {
      console.log('check-vignette (REWRITE.md § G, gate G1 part one)');
      for (const l of r.lines) console.log(l);
      console.log(r.ok ? 'PASS' : 'FAIL');
      if (v.json) writeFileSync(v.json, JSON.stringify(r.data, null, 2));
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e: unknown) => {
      console.error(String(e));
      process.exit(2);
    });
}
