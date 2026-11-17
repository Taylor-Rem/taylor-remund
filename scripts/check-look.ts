// check-look: gate G1 part one, "every mesh comes from the kit; every colour
// is a palette token" (REWRITE.md § E3, § G P1).
//
// Static rules over the workshop sources (and the dev pages):
// - geometry and mesh construction only in the kit,
// - material construction only in the materials folder,
// - colour literals only in the palette file.
// Deriving a colour from a token in code (lerp, multiply, offsetHSL) is fine.
// GLSL is left alone: a vec3(...) in a shader is not checked.

import { Report } from './lib/report.ts';
import { runCli } from './lib/cli.ts';
import { tokenize } from './lib/jstok.ts';
import type { Token } from './lib/jstok.ts';
import { sourceFiles, under } from './lib/source.ts';

// ---- Where things may live (adjust here) -----------------------------------
export const SCAN_DIRS: readonly string[] = ['src/workshop', 'src/dev-pages'];
export const KIT_DIRS: readonly string[] = ['src/workshop/view/kit'];
export const MATERIAL_DIRS: readonly string[] = ['src/workshop/view/materials'];
export const PALETTE_FILES: readonly string[] = ['src/workshop/view/palette.ts'];
// -----------------------------------------------------------------------------

const inKit = (f: string): boolean => KIT_DIRS.some((d) => under(f, d));
const inMaterials = (f: string): boolean => MATERIAL_DIRS.some((d) => under(f, d));
const isPalette = (f: string): boolean => PALETTE_FILES.includes(f);

const MESH_CLASSES = new Set(['Mesh', 'InstancedMesh', 'SkinnedMesh', 'BatchedMesh', 'Points', 'Sprite']);
const LIGHTS = new Set(['AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight', 'RectAreaLight']);

export function isGeometryClass(name: string): boolean {
  if (/Material$/.test(name)) return false;
  return /Geometry$/.test(name) || MESH_CLASSES.has(name) || (/^Line/.test(name) && !/^Line(3|Curve)/.test(name));
}

export function isMaterialClass(name: string): boolean {
  return /Material$/.test(name);
}

const HEX_STRING = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HEX_EMBEDDED = /#(?:[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const FUNC_COLOUR = /\b(?:rgba?|hsla?|oklab|oklch)\s*\(/i;
const HEX_NUMBER = /^0[xX][0-9a-fA-F]{6}$/;
const COLOUR_PROP = /^(?:colou?r|emissive|specular|sheenColor|attenuationColor|groundColor|skyColor|background|fog|tint|\w+Colou?r)$/;

/** CSS named colours (CSS Color 4), for `new Color('red')` and friends. */
export const CSS_COLOUR_NAMES = new Set(
  ('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse ' +
    'chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green ' +
    'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey ' +
    'lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive ' +
    'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey ' +
    'snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent').split(' '),
);

export interface LookViolation {
  file: string;
  line: number;
  rule: string;
}

/** Is a string token a colour literal? */
export function stringIsColour(s: string): boolean {
  const t = s.trim();
  return HEX_STRING.test(t) || HEX_EMBEDDED.test(t) || FUNC_COLOUR.test(t);
}

/** Token index just past the `(...)` starting at `open`, and the tokens inside (depth 1 and deeper). */
function argsOf(toks: Token[], open: number): { inside: Token[]; end: number } {
  let depth = 0;
  const inside: Token[] = [];
  for (let k = open; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) {
      depth++;
      if (depth === 1) continue;
    } else if (t.type === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) {
      depth--;
      if (depth === 0) return { inside, end: k + 1 };
    }
    inside.push(t);
  }
  return { inside, end: toks.length };
}

/** `new [ns.]Name` at k: returns Name and the index of the token after it. */
function newExpr(toks: Token[], k: number): { name: string; next: number } | null {
  if (toks[k].type !== 'ident' || toks[k].value !== 'new') return null;
  let m = k + 1;
  if (toks[m]?.type === 'ident' && toks[m + 1]?.value === '.' && toks[m + 2]?.type === 'ident') m += 2;
  if (toks[m]?.type !== 'ident') return null;
  return { name: toks[m].value, next: m + 1 };
}

/** `extends [ns.]Name` at k. */
function extendsExpr(toks: Token[], k: number): string | null {
  if (toks[k].type !== 'ident' || toks[k].value !== 'extends') return null;
  let m = k + 1;
  if (toks[m]?.type === 'ident' && toks[m + 1]?.value === '.' && toks[m + 2]?.type === 'ident') m += 2;
  return toks[m]?.type === 'ident' ? toks[m].value : null;
}

const isNum = (t: Token): boolean => t.type === 'num';
const isLiteralColour = (t: Token): boolean =>
  (t.type === 'num' && HEX_NUMBER.test(t.value)) ||
  ((t.type === 'str' || (t.type === 'tmpl' && !t.open && !t.cont)) && (stringIsColour(t.value) || CSS_COLOUR_NAMES.has(t.value.trim().toLowerCase())));

export function lookViolations(path: string, code: string): LookViolation[] {
  const out: LookViolation[] = [];
  const toks = tokenize(code);
  const palette = isPalette(path);
  const flagged = new Set<number>(); // token indexes already reported as colours
  const add = (k: number, rule: string): void => {
    out.push({ file: path, line: toks[k].line, rule });
  };
  const colour = (k: number, rule: string): void => {
    if (palette || flagged.has(k)) return;
    flagged.add(k);
    add(k, rule);
  };

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const ne = newExpr(toks, k);
    if (ne) {
      if (isGeometryClass(ne.name) && !inKit(path)) add(k, `mesh-from-kit: new ${ne.name}() outside ${KIT_DIRS.join(', ')}`);
      if (isMaterialClass(ne.name) && !inMaterials(path)) add(k, `material-from-materials: new ${ne.name}() outside ${MATERIAL_DIRS.join(', ')}`);
      if ((ne.name === 'Color' || LIGHTS.has(ne.name) || ne.name === 'Fog' || ne.name === 'FogExp2') && toks[ne.next]?.value === '(') {
        const { inside } = argsOf(toks, ne.next);
        const lits = inside.filter((u) => isLiteralColour(u) || (ne.name === 'Color' && isNum(u)));
        if (lits.length && !palette) colour(toks.indexOf(lits[0], k), `colour-in-palette: literal colour in new ${ne.name}(…) outside ${PALETTE_FILES.join(', ')}`);
      }
    }
    const ext = extendsExpr(toks, k);
    if (ext) {
      if (isGeometryClass(ext) && !inKit(path)) add(k, `mesh-from-kit: class extends ${ext} outside ${KIT_DIRS.join(', ')}`);
      if (isMaterialClass(ext) && !inMaterials(path)) add(k, `material-from-materials: class extends ${ext} outside ${MATERIAL_DIRS.join(', ')}`);
    }
    // .setHex(lit) .setStyle(lit) .setRGB(num…) .setHSL(num…) .setColorName(lit)
    if (t.type === 'punct' && (t.value === '.' || t.value === '?.') && toks[k + 1]?.type === 'ident' && toks[k + 2]?.value === '(') {
      const method = toks[k + 1].value;
      if (['setHex', 'setStyle', 'setColorName', 'setRGB', 'setHSL', 'setScalar'].includes(method)) {
        const { inside } = argsOf(toks, k + 2);
        const numeric = method === 'setRGB' || method === 'setHSL' || method === 'setHex';
        const lit = inside.find((u) => isLiteralColour(u) || (numeric && isNum(u)));
        if (lit && method !== 'setScalar') colour(toks.indexOf(lit, k), `colour-in-palette: literal colour in .${method}(…) outside ${PALETTE_FILES.join(', ')}`);
      }
    }
    // colour-ish property set to a literal: `color: 0xff0000`, `x.emissive = '#fff'`
    if ((t.type === 'ident' || t.type === 'str') && COLOUR_PROP.test(t.value)) {
      const op = toks[k + 1];
      const v = toks[k + 2];
      if (op?.type === 'punct' && (op.value === ':' || op.value === '=') && v && isLiteralColour(v)) {
        colour(k + 2, `colour-in-palette: literal colour for "${t.value}" outside ${PALETTE_FILES.join(', ')}`);
      }
    }
    // any other hex or rgb()/hsl() string literal anywhere
    if ((t.type === 'str' || t.type === 'tmpl') && stringIsColour(t.value)) {
      colour(k, `colour-in-palette: colour string literal outside ${PALETTE_FILES.join(', ')}`);
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

export interface LookOptions {
  root: string;
}

export function checkLook(opts: LookOptions): Report {
  const r = new Report('check-look');
  const files = sourceFiles(opts.root, SCAN_DIRS);
  let n = 0;
  for (const f of files) {
    const lines = f.code.split('\n');
    for (const v of lookViolations(f.path, f.code)) {
      n++;
      const text = (lines[v.line - 1] ?? '').trim();
      r.fail(`${v.file}:${v.line} ${v.rule} — ${text.length > 100 ? text.slice(0, 97) + '...' : text}`);
    }
  }
  r.info(`       ${files.length} source file${files.length === 1 ? '' : 's'} under ${SCAN_DIRS.join(', ')}; kit: ${KIT_DIRS.join(', ')}; materials: ${MATERIAL_DIRS.join(', ')}; palette: ${PALETTE_FILES.join(', ')}`);
  r.info('       not checked: vec3(...) literals in GLSL, CSS in .astro markup (hex and rgb()/hsl() strings in shader templates are checked)');
  if (n === 0) r.ok('every mesh from the kit, every material from materials, every colour literal in the palette');
  return r;
}

runCli(import.meta.url, {
  name: 'check-look',
  summary: 'Gate G1 part one: geometry and meshes only in the kit, materials only in materials/, colour literals only in the palette.',
  usesDist: false,
}, (o) => checkLook({ root: o.root }));
