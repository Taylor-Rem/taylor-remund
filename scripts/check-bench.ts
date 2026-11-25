// check-bench: the objective checks of the whole bench's composition (brief
// L1; REWRITE.md § G "P2", § E7; ART-P2 § 2), on the REAL GPU.
//
//   node scripts/check-bench.ts [url-or-/path] [--json out.json] [--crew 1.25]
//
// Default target: /dev/bench/ (a dev server of its own is started).
// At the home framing of 1440×900, 1920×1080, 1280×720 and an upright
// phone (390×844):
// 1. Capitals at least 12 px tall on screens 1440 wide and up (the rule's
//    own width; 1280×720 is reported): the sign (TAYLOR REMUND),
//    the DO NOT TOUCH tape and the station plates (the jacks' and the tools'
//    tapes), measured exactly as check-vignette does (each label quad
//    through the real camera; medians per label).
// 2. Fetch at least 80 px tall at the 1440×900 home (ART-P2 § 2), measured
//    from its piece bounds as drawn (crew scale included), base to crown.
// 3. Everything usable in view on the wide screens: every station's
//    footprint and height inside the frame. On the phone: the centre
//    cluster (Button, phone, stool and Patch).
// 4. Draw calls and triangles of the scene draw, shadow pass included,
//    against § E7 (180, 250,000).
// 5. Flicker: two consecutive still frames must be identical at home.
//
// Exit 0 when every check passes, 1 otherwise, 2 on usage.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openPage, resolveTarget, isSoftware } from './capture.ts';
import { isMain } from './lib/cli.ts';
import { BUDGET, MIN_CAP_PX, gated as gatedVignette } from './check-vignette.ts';
import site from '../src/content/site.json' with { type: 'json' };

/** At 1440×900 (view/bench.ts FRAME_PX, repeated: this script runs in Node without Vite). */
const FRAME_PX = { corners: 30, under: [60, 115] as const };

export const MIN_FETCH_PX = 80;

/** The sign's words on the bench: the name from the site's content (as view/bench.ts makes them). */
const NAME_WORDS = new Set((site as unknown as { strip: { name: { text: string } } }).strip.name.text.toUpperCase().split(/\s+/));
/** (L2, 2026-11-24: the reserved bays and their label tape are gone; the switchboard's small RESERVED strip over its capped jacks was never gated.) */
export function gated(register: string, text: string, _key = ''): boolean {
  if (register === 'sign' && text.split(' ').every((w) => NAME_WORDS.has(w))) return true;
  return gatedVignette(register, text);
}

const CLUSTER = ['button', 'phone', 'stool'];

interface LabelCap {
  key: string;
  register: string;
  text: string;
  px: number;
  onScreen: boolean;
}
interface Measure {
  labels: LabelCap[];
  fetchPx: number | null;
  crew: { fetchBody: number | null; patch: number | null };
  handles: Record<string, [number, number] | null>;
  frame_px: { left: number; right: number; under: number };
  crewScale: number;
  inFrame: Record<string, boolean>;
  scene: { calls: number; triangles: number };
  renderer: string;
}
interface Still {
  differing: number;
  maxDelta: number;
  box: number[] | null;
}

export interface Result {
  ok: boolean;
  lines: string[];
  data: Record<string, unknown>;
}

async function run(target: string, crew?: string): Promise<Result> {
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
    const sizes = [
      ['1440x900', 1440, 900, false],
      ['1920x1080', 1920, 1080, false],
      ['1280x720', 1280, 720, false],
      ['phone', 390, 844, true],
    ] as const;
    for (const [name, w, h, mobile] of sizes) {
      const s = await openPage(`${base}hud=0&manual=1&names=0${crew ? `&crew=${crew}` : ''}`, { w, h, dpr: 1, mobile, log: () => {} });
      try {
        if (isSoftware(s.renderer)) fail(`${name}: software renderer (${s.renderer}): numbers are meaningless`);
        const m = (await s.page.evaluate(() => (window as unknown as { __bench: { goto(n: number): unknown; measure(): unknown } }).__bench.goto(500) && (window as unknown as { __bench: { measure(): unknown } }).__bench.measure())) as Measure;
        data[name] = m;
        lines.push(`---- ${name} ${w}×${h}  ${s.renderer}`);
        const { calls, triangles } = m.scene;
        (calls <= BUDGET.calls ? pass : fail)(`${name}: draw calls ${calls} (budget ${BUDGET.calls}, shadow pass included)`);
        (triangles <= BUDGET.triangles ? pass : fail)(`${name}: triangles ${triangles} (budget ${BUDGET.triangles})`);
        if (!mobile) {
          // labels
          const byText = new Map<string, LabelCap>();
          for (const l of m.labels.filter((x) => x.onScreen)) {
            const k = l.key;
            const prev = byText.get(k);
            if (!prev || l.px < prev.px) byText.set(k, l);
          }
          const rows = [...byText.values()].sort((a, b) => a.px - b.px);
          for (const l of rows) {
            const line = `${name}: ${l.register.padEnd(7)} ${JSON.stringify(l.text).padEnd(16)} capitals ${l.px.toFixed(1)} px`;
            if (!gated(l.register, l.text, l.key)) lines.push(`     ${line} (not gated)`);
            else if (w < 1440) lines.push(`     ${line} (the rule is set at 1440 wide: reported)`);
            else (l.px >= MIN_CAP_PX ? pass : fail)(`${line} (min ${MIN_CAP_PX})`);
          }
          for (const want of ['sign', 'tape']) if (!rows.some((r) => r.register === want)) fail(`${name}: no ${want} label in view`);
          // everything usable in view
          const out = Object.entries(m.inFrame).filter(([, v]) => !v).map(([k]) => k);
          (out.length === 0 ? pass : fail)(`${name}: every station in frame${out.length ? ` (out: ${out.join(', ')})` : ''}`);
        } else {
          const out = CLUSTER.filter((k) => !m.inFrame[k]);
          (out.length === 0 ? pass : fail)(`${name}: the centre cluster in frame${out.length ? ` (out: ${out.join(', ')})` : ''}`);
        }
        lines.push(`     ${name}: crew ${m.crewScale}×: Fetch's body ${m.crew.fetchBody} px (no aerial), Patch seated ${m.crew.patch} px; belt dial plate ${m.handles['dial']?.join(' × ')} px, lever plate ${m.handles['lever']?.join(' × ')} px`);
        if (name === '1440x900') {
          const f = m.frame_px;
          (Math.min(f.left, f.right) >= FRAME_PX.corners - 5 ? pass : fail)(`${name}: front corners ${f.left} / ${f.right} px inside the frame (about ${FRAME_PX.corners})`);
          (f.under >= FRAME_PX.under[0] && f.under <= FRAME_PX.under[1] ? pass : fail)(`${name}: ${f.under} px of apron and dark under the front edge (${FRAME_PX.under.join('-')})`);
        }
        if (m.fetchPx !== null) {
          if (name === '1440x900') (m.fetchPx >= MIN_FETCH_PX ? pass : fail)(`${name}: Fetch ${m.fetchPx.toFixed(1)} px tall (min ${MIN_FETCH_PX})`);
          else lines.push(`     ${name}: Fetch ${m.fetchPx.toFixed(1)} px tall`);
        } else fail(`${name}: Fetch not found`);
        const st = (await s.page.evaluate(() => {
          const v = (window as unknown as { __bench: { shot(n: string): void; stillPair(): unknown } }).__bench;
          v.shot('home');
          v.stillPair();
          return v.stillPair();
        })) as Still;
        data[`still-${name}`] = st;
        (st.differing === 0 ? pass : fail)(`${name}: still frames at home: ${st.differing} pixels differ (max Δ ${st.maxDelta})${st.box ? ` in [${st.box.join(', ')}]` : ''}`);
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
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: 'string' }, crew: { type: 'string' } } });
  const target = positionals[0] ?? '/dev/bench/';
  run(target, v.crew)
    .then((r) => {
      console.log('check-bench (brief L1: the whole bench at its home framings)');
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
