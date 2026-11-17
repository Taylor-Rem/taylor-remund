// check-layers: the "must not" column of REWRITE.md § E2 and invariants 2
// and 4 of § E4, as static rules over imports and globals.
//
// The rules table is below; each rule prints its reason on a violation.

import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { findImports, tokenize } from './lib/jstok.ts';
import type { Token } from './lib/jstok.ts';
import { loadAliases, resolveSpecifier, sourceFiles, stem, under } from './lib/source.ts';
import type { Target } from './lib/source.ts';

export const SCAN_DIRS: readonly string[] = ['src/workshop', 'src/content'];

const W = 'src/workshop';
const SIM = `${W}/sim`;
const PHYSICS = `${SIM}/physics`;
const MACHINES = `${SIM}/machines`;
const MACHINES_SHARED = `${MACHINES}/shared`;
const VIEW = `${W}/view`;
const STATIONS = `${VIEW}/stations`;
const INPUT = `${W}/input`;
const AUDIO = `${W}/audio`;
const UI = `${W}/ui`;
const SHELL = `${W}/shell`;
const CONTENT = 'src/content';
/** Files directly under sim/machines/ that are not machines: the registry, shared types, shared code. */
const MACHINES_NOT_A_MACHINE = ['index', 'types', 'shared'];

const stripExt = (p: string): string => p.replace(/\.(m|c)?[jt]sx?$/, '');

const isRapier = (t: Target): boolean => t.kind === 'package' && /^@dimforge\/rapier/.test(t.name);
const isThree = (t: Target): boolean => t.kind === 'package' && t.name === 'three';
const isAstro = (t: Target): boolean =>
  (t.kind === 'virtual' && t.specifier.startsWith('astro:')) || (t.kind === 'package' && (t.name === 'astro' || t.name.startsWith('@astrojs/')));
const inDir = (t: Target, dir: string): boolean => t.kind === 'file' && under(t.path, dir);
const inAny = (t: Target, dirs: string[]): boolean => dirs.some((d) => inDir(t, d));

/** Machine name of a path under sim/machines/ (`belt` for `.../machines/belt/x.ts` or `.../machines/belt.ts`), or null. */
export function machineOf(path: string): string | null {
  if (!under(path, MACHINES)) return null;
  const rest = path.slice(MACHINES.length + 1);
  const first = rest.split('/')[0];
  return rest.includes('/') ? first : stem(first);
}

export interface ImportRule {
  id: string;
  /** Does the rule govern files at this path? */
  appliesTo: (file: string) => boolean;
  /** Is importing this target a violation from this file? */
  forbids: (target: Target, file: string) => boolean;
  reason: string;
}

/** Import rules, most specific first; the first matching rule reports an import. */
export const IMPORT_RULES: readonly ImportRule[] = [
  {
    id: 'rapier-only-in-physics',
    appliesTo: () => true,
    forbids: (t, f) => isRapier(t) && !under(f, PHYSICS),
    reason: 'the Rapier package is imported only under src/workshop/sim/physics/ (the physics adapter)',
  },
  {
    id: 'sim-no-three',
    appliesTo: (f) => under(f, SIM),
    forbids: (t) => isThree(t),
    reason: 'sim does not know it is being drawn: no Three.js (§ E2; it runs in Node for tests)',
  },
  {
    id: 'sim-no-astro',
    appliesTo: (f) => under(f, SIM),
    forbids: (t) => isAstro(t),
    reason: 'sim runs in Node for tests: no astro:* or Astro modules',
  },
  {
    id: 'sim-no-content',
    appliesTo: (f) => under(f, SIM),
    forbids: (t) => inDir(t, CONTENT),
    reason: 'sim emits ids; the text lives in src/content and is read by view/ui (§ E4 invariant 5)',
  },
  {
    id: 'sim-no-outer-layers',
    appliesTo: (f) => under(f, SIM),
    forbids: (t) => inAny(t, [VIEW, INPUT, AUDIO, UI, SHELL]),
    reason: 'sim does not import view/, input/, audio/, ui/ or shell/ (§ E2, § J "the one rule not to bend")',
  },
  {
    id: 'machines-do-not-call-each-other',
    appliesTo: (f) => {
      const m = machineOf(f);
      return m !== null && !MACHINES_NOT_A_MACHINE.includes(m);
    },
    forbids: (t, f) => {
      if (t.kind !== 'file' || under(t.path, MACHINES_SHARED)) return false;
      const m = machineOf(t.path);
      return m !== null && m !== 'shared' && m !== 'types' && m !== machineOf(f);
    },
    reason: 'machines do not call each other; they meet through parts, instructions and the bus (§ E4 invariant 2); share code via sim/machines/shared/',
  },
  {
    id: 'sim-imports-only-sim',
    appliesTo: (f) => under(f, SIM),
    forbids: (t, f) => !(inDir(t, SIM) || (isRapier(t) && under(f, PHYSICS))),
    reason: 'sim may import only from src/workshop/sim/ (and Rapier inside sim/physics/); a new package here is a new runtime dependency',
  },
  {
    id: 'view-no-input-ui-audio-shell',
    appliesTo: (f) => under(f, VIEW),
    forbids: (t) => inAny(t, [INPUT, UI, AUDIO, SHELL]),
    reason: 'view turns simulation state into a picture; it does not import input/, ui/, audio/ or shell/',
  },
  {
    id: 'view-reads-sim-surface-only',
    appliesTo: (f) => under(f, VIEW),
    forbids: (t) => t.kind === 'file' && under(t.path, SIM) && stripExt(t.path) !== `${SIM}/index` && stem(t.path) !== 'types',
    reason: 'view must not change simulation state: from sim it imports only src/workshop/sim/index.ts or a types.ts',
  },
  {
    id: 'input-knows-no-machine',
    appliesTo: (f) => under(f, INPUT),
    forbids: (t) => inAny(t, [MACHINES, STATIONS]),
    reason: 'input turns pointer, touch and keys into intents; it does not know what any machine does',
  },
  {
    id: 'audio-decides-nothing',
    appliesTo: (f) => under(f, AUDIO),
    forbids: (t) => inAny(t, [INPUT, UI, SHELL]),
    reason: 'audio plays sound for simulation events; it does not import input/, ui/ or shell/',
  },
  {
    id: 'ui-no-three-no-machines',
    appliesTo: (f) => under(f, UI),
    forbids: (t) => isThree(t) || inDir(t, MACHINES),
    reason: 'ui is the HTML around the stage: no Three.js, no machine internals',
  },
  {
    id: 'shell-knows-no-station',
    appliesTo: (f) => under(f, SHELL),
    forbids: (t) => inAny(t, [MACHINES, STATIONS]),
    reason: 'shell starts, chooses a tier, falls back and saves; it must not know about any particular station',
  },
  {
    id: 'content-is-self-contained',
    appliesTo: (f) => under(f, CONTENT),
    forbids: (t) => !inDir(t, CONTENT),
    reason: 'content holds facts and sentences only; it imports nothing outside src/content/',
  },
];

export interface GlobalRule {
  id: string;
  /** Matches at token index k; returns the matched text or null. */
  match: (toks: Token[], k: number) => string | null;
  reason: string;
}

const isDotTok = (t: Token | undefined): boolean => !!t && t.type === 'punct' && (t.value === '.' || t.value === '?.');

/** `obj.prop`, `obj?.prop`, `obj['prop']`, `globalThis.obj.prop` at k (k is `obj`). */
function member(toks: Token[], k: number, obj: string, prop: string): boolean {
  const t = toks[k];
  if (t.type !== 'ident' || t.value !== obj) return false;
  const prev = toks[k - 1];
  if (isDotTok(prev) && !(toks[k - 2]?.type === 'ident' && ['globalThis', 'window', 'self'].includes(toks[k - 2].value))) return false;
  const n1 = toks[k + 1];
  const n2 = toks[k + 2];
  if (isDotTok(n1) && n2?.type === 'ident' && n2.value === prop) return true;
  if (n1?.value === '[' && n2?.type === 'str' && n2.value === prop && toks[k + 3]?.value === ']') return true;
  return false;
}

/** A free reference to global `name` at k (not a property, not an object key, not a declaration name). */
function freeGlobal(toks: Token[], k: number, name: string): boolean {
  const t = toks[k];
  if (t.type !== 'ident' || t.value !== name) return false;
  const prev = toks[k - 1];
  const next = toks[k + 1];
  if (isDotTok(prev) && !(toks[k - 2]?.type === 'ident' && toks[k - 2].value === 'globalThis')) return false;
  if (next?.type === 'punct' && next.value === ':' && (prev?.value === '{' || prev?.value === ',')) return false; // object key
  if (prev?.type === 'ident' && ['const', 'let', 'var', 'function', 'class', 'interface', 'type'].includes(prev.value)) return false;
  return true;
}

const DOM_GLOBALS = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'fetch'];

/** Determinism rules for sim (§ E4 invariant 4): time, randomness and the browser come in through the clock, the rng and the shell. */
export const SIM_GLOBAL_RULES: readonly GlobalRule[] = [
  { id: 'no-Math.random', match: (t, k) => (member(t, k, 'Math', 'random') ? 'Math.random' : null), reason: 'sim is deterministic from a seed: use the sim rng' },
  { id: 'no-Date.now', match: (t, k) => (member(t, k, 'Date', 'now') ? 'Date.now' : null), reason: 'sim is deterministic: time comes from the sim clock' },
  {
    id: 'no-new-Date',
    match: (t, k) => (t[k].type === 'ident' && t[k].value === 'new' && t[k + 1]?.value === 'Date' ? 'new Date' : null),
    reason: 'sim is deterministic: time comes from the sim clock',
  },
  {
    id: 'no-Date()',
    match: (t, k) => (freeGlobal(t, k, 'Date') && t[k + 1]?.value === '(' && t[k - 1]?.value !== 'new' ? 'Date()' : null),
    reason: 'sim is deterministic: time comes from the sim clock',
  },
  { id: 'no-performance.now', match: (t, k) => (member(t, k, 'performance', 'now') ? 'performance.now' : null), reason: 'sim is deterministic: time comes from the sim clock' },
  {
    id: 'no-crypto-random',
    match: (t, k) => (member(t, k, 'crypto', 'getRandomValues') ? 'crypto.getRandomValues' : member(t, k, 'crypto', 'randomUUID') ? 'crypto.randomUUID' : null),
    reason: 'sim is deterministic from a seed: use the sim rng',
  },
  ...['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'setImmediate'].map((name) => ({
    id: `no-${name}`,
    match: (t: Token[], k: number) => (freeGlobal(t, k, name) ? name : null),
    reason: 'sim advances only when the clock steps it; scheduling belongs to the shell',
  })),
  ...DOM_GLOBALS.map((name) => ({
    id: `no-${name}`,
    match: (t: Token[], k: number) => (freeGlobal(t, k, name) ? name : null),
    reason: 'sim does not touch the DOM or the network; it runs in Node for tests',
  })),
];

export interface Violation {
  file: string;
  line: number;
  rule: string;
  what: string;
  reason: string;
}

export function layerViolations(root: string): { files: number; violations: Violation[] } {
  const files = sourceFiles(root, SCAN_DIRS);
  const aliases = loadAliases(root);
  const violations: Violation[] = [];
  for (const f of files) {
    const toks = tokenize(f.code);
    for (const imp of findImports(toks)) {
      if (imp.specifier === null) {
        if (under(f.path, SIM) || under(f.path, CONTENT)) {
          violations.push({ file: f.path, line: imp.line, rule: 'literal-imports-only', what: `${imp.kind} import with a computed specifier`, reason: 'a computed import cannot be checked against the layer rules; use a literal specifier' });
        }
        continue;
      }
      const target = resolveSpecifier(root, f.path, imp.specifier, aliases);
      for (const rule of IMPORT_RULES) {
        if (rule.appliesTo(f.path) && rule.forbids(target, f.path)) {
          violations.push({ file: f.path, line: imp.line, rule: rule.id, what: `imports "${imp.specifier}"${imp.typeOnly ? ' (type-only)' : ''}`, reason: rule.reason });
          break;
        }
      }
    }
    if (under(f.path, SIM)) {
      for (let k = 0; k < toks.length; k++) {
        for (const rule of SIM_GLOBAL_RULES) {
          const m = rule.match(toks, k);
          if (m) {
            violations.push({ file: f.path, line: toks[k].line, rule: rule.id, what: `uses ${m}`, reason: rule.reason });
            break;
          }
        }
      }
    }
  }
  return { files: files.length, violations };
}

export interface LayersOptions {
  root: string;
}

export function checkLayers(opts: LayersOptions): Report {
  const r = new Report('check-layers');
  const { files, violations } = layerViolations(opts.root);
  for (const v of violations) r.fail(`${v.file}:${v.line} ${v.rule} — ${v.what}: ${v.reason}`);
  r.info(`       ${files} source file${files === 1 ? '' : 's'} under ${SCAN_DIRS.join(', ')}; ${IMPORT_RULES.length} import rules, ${SIM_GLOBAL_RULES.length} determinism rules`);
  if (violations.length === 0) r.ok('every layer imports only what § E2 allows');
  return r;
}

runCli(import.meta.url, {
  name: 'check-layers',
  summary: 'The layer rules of REWRITE.md § E2 and § E4 (invariants 2 and 4): who may import whom under src/workshop and src/content, and no time, randomness or DOM in sim.',
  usesDist: false,
}, (o) => checkLayers({ root: o.root }));
