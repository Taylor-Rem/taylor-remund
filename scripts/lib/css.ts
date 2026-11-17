// URL references in CSS: url(...) and @import.

export interface CssRef {
  url: string;
  kind: 'url' | 'import';
  /** True for a url() that is not the first source of an @font-face `src`. */
  fontFallback: boolean;
}

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

export function cssRefs(cssIn: string): CssRef[] {
  const css = stripCssComments(cssIn);
  const refs: CssRef[] = [];
  const importRe = /@import\s+(?:url\(\s*([^)]*?)\s*\)|("[^"]*"|'[^']*'))/gi;
  const importSpans: [number, number][] = [];
  for (let m = importRe.exec(css); m; m = importRe.exec(css)) {
    refs.push({ url: unquote(m[1] ?? m[2]), kind: 'import', fontFallback: false });
    importSpans.push([m.index, m.index + m[0].length]);
  }
  // Find which url()s are later sources inside an @font-face src list.
  const fallbackAt = new Set<number>();
  const faceRe = /@font-face\s*\{([^}]*)\}/gi;
  for (let f = faceRe.exec(css); f; f = faceRe.exec(css)) {
    const bodyStart = f.index + f[0].indexOf('{') + 1;
    const srcRe = /(^|[;{\s])src\s*:([^;}]*)/gi;
    for (let s = srcRe.exec(f[1]); s; s = srcRe.exec(f[1])) {
      const declStart = bodyStart + s.index + s[0].length - s[2].length;
      const urlRe = /url\(/gi;
      let first = true;
      for (let u = urlRe.exec(s[2]); u; u = urlRe.exec(s[2])) {
        if (!first) fallbackAt.add(declStart + u.index);
        first = false;
      }
    }
  }
  const urlRe = /url\(\s*("[^"]*"|'[^']*'|[^)]*?)\s*\)/gi;
  for (let m = urlRe.exec(css); m; m = urlRe.exec(css)) {
    if (importSpans.some(([a, b]) => m!.index >= a && m!.index < b)) continue;
    refs.push({ url: unquote(m[1]), kind: 'url', fontFallback: fallbackAt.has(m.index) });
  }
  return refs.filter((r) => r.url !== '');
}
