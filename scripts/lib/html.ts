// A small HTML tag scanner: enough to find tags, attributes, ids, elements
// and text in pages we build ourselves. Not a full HTML5 parser.
//
// Offsets are indices into the string passed in. To get byte offsets, pass
// the file decoded as 'latin1' (one char per byte).

export interface Tag {
  /** Lower-case element name. */
  name: string;
  /** True for `</name>`. */
  closing: boolean;
  /** True for `<name ... />`. */
  selfClosing: boolean;
  /** Attribute names lower-cased; values raw (entities not decoded). */
  attrs: Map<string, string>;
  /** Index of `<`. */
  start: number;
  /** Index just past `>`. */
  end: number;
}

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'source', 'track', 'wbr',
]);

/** Every tag in `html`, skipping comments, doctypes and raw-text contents. */
export function scanTags(html: string): Tag[] {
  const tags: Tag[] = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close < 0 ? n : close + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const close = html.indexOf('>', lt);
      i = close < 0 ? n : close + 1;
      continue;
    }
    const closing = html[lt + 1] === '/';
    let j = lt + (closing ? 2 : 1);
    const nameMatch = /^[A-Za-z][A-Za-z0-9:-]*/.exec(html.slice(j, j + 64));
    if (!nameMatch) {
      i = lt + 1;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    j += nameMatch[0].length;
    const attrs = new Map<string, string>();
    let selfClosing = false;
    // attributes
    while (j < n) {
      while (j < n && /\s/.test(html[j])) j++;
      if (j >= n) break;
      if (html[j] === '>') {
        j++;
        break;
      }
      if (html[j] === '/' && html[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      if (html[j] === '/') {
        j++;
        continue;
      }
      const an = /^[^\s"'>/=]+/.exec(html.slice(j, j + 256));
      if (!an) {
        j++;
        continue;
      }
      const attrName = an[0].toLowerCase();
      j += an[0].length;
      while (j < n && /\s/.test(html[j])) j++;
      let value = '';
      if (html[j] === '=') {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        const q = html[j];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, j + 1);
          const stop = close < 0 ? n : close;
          value = html.slice(j + 1, stop);
          j = stop + 1;
        } else {
          const m = /^[^\s>]*/.exec(html.slice(j));
          value = m ? m[0] : '';
          j += value.length;
        }
      }
      if (!attrs.has(attrName)) attrs.set(attrName, value);
    }
    tags.push({ name, closing, selfClosing, attrs, start: lt, end: j });
    i = j;
    if (!closing && RAW_TEXT.has(name)) {
      const re = new RegExp(`</${name}[\\s>/]`, 'ig');
      re.lastIndex = j;
      const m = re.exec(html);
      i = m ? m.index : n;
    }
  }
  return tags;
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', middot: '·', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', times: '×',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  bull: '•', deg: '°', euro: '€', pound: '£', cent: '¢',
  sect: '§', para: '¶', laquo: '«', raquo: '»', shy: '­',
  thinsp: ' ', ensp: ' ', emsp: ' ', zwj: '‍', zwnj: '‌',
};

/** Decodes numeric and the common named character references. Unknown names stay as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED[body] ?? whole;
  });
}

export function attr(tag: Tag, name: string): string | undefined {
  const v = tag.attrs.get(name);
  return v === undefined ? undefined : decodeEntities(v);
}

export function classList(tag: Tag): string[] {
  const c = attr(tag, 'class');
  return c ? c.split(/\s+/).filter(Boolean) : [];
}

/** All `id` values (and `name` values on `<a>`, when `withNames`). */
export function collectIds(html: string, withNames = false): Set<string> {
  const ids = new Set<string>();
  for (const t of scanTags(html)) {
    if (t.closing) continue;
    const id = attr(t, 'id');
    if (id !== undefined) ids.add(id);
    if (withNames && t.name === 'a') {
      const nm = attr(t, 'name');
      if (nm !== undefined) ids.add(nm);
    }
  }
  return ids;
}

/**
 * Index just past the close tag matching the open tag at `tags[openIndex]`,
 * or -1 when it is never closed.
 */
export function matchingCloseEnd(tags: Tag[], openIndex: number): number {
  const open = tags[openIndex];
  if (open.selfClosing || VOID_ELEMENTS.has(open.name)) return open.end;
  let depth = 0;
  for (let k = openIndex; k < tags.length; k++) {
    const t = tags[k];
    if (t.name !== open.name) continue;
    if (t.closing) {
      depth--;
      if (depth === 0) return t.end;
    } else if (!t.selfClosing) {
      depth++;
    }
  }
  return -1;
}

export interface Element {
  tag: Tag;
  /** Index of `<` of the open tag. */
  start: number;
  /** Index just past the matching close tag (-1 when unclosed). */
  end: number;
  /** The raw opening tag text. */
  openText: string;
}

/** Every element whose open tag satisfies `pred`, with its extent. */
export function findElements(html: string, pred: (t: Tag) => boolean, tags: Tag[] = scanTags(html)): Element[] {
  const out: Element[] = [];
  tags.forEach((t, k) => {
    if (t.closing || !pred(t)) return;
    out.push({ tag: t, start: t.start, end: matchingCloseEnd(tags, k), openText: html.slice(t.start, t.end) });
  });
  return out;
}

/** Visible text: scripts and styles dropped, tags removed, entities decoded, whitespace collapsed. */
export function visibleText(html: string): string {
  const tags = scanTags(html);
  let out = '';
  let pos = 0;
  for (let k = 0; k < tags.length; k++) {
    const t = tags[k];
    out += html.slice(pos, t.start);
    pos = t.end;
    if (!t.closing && (t.name === 'script' || t.name === 'style' || t.name === 'template')) {
      const close = tags.findIndex((u, m) => m > k && u.closing && u.name === t.name);
      if (close >= 0) {
        k = close;
        pos = tags[close].end;
      }
    }
    // Block-ish boundaries become spaces so words don't run together.
    if (/^(p|div|li|br|h[1-6]|td|th|tr|section|article|header|footer|nav|main|ul|ol|dt|dd|blockquote)$/.test(t.name)) {
      out += ' ';
    }
  }
  out += html.slice(pos);
  return decodeEntities(out).replace(/[\s ]+/g, ' ').trim();
}

/** Contents of every inline `<style>` element. */
export function inlineStyles(html: string): string[] {
  const tags = scanTags(html);
  const out: string[] = [];
  tags.forEach((t, k) => {
    if (t.closing || t.name !== 'style') return;
    const close = tags.findIndex((u, m) => m > k && u.closing && u.name === 'style');
    out.push(html.slice(t.end, close >= 0 ? tags[close].start : html.length));
  });
  return out;
}

/** Contents and attributes of every `<script>` element. */
export function scripts(html: string): { tag: Tag; body: string }[] {
  const tags = scanTags(html);
  const out: { tag: Tag; body: string }[] = [];
  tags.forEach((t, k) => {
    if (t.closing || t.name !== 'script') return;
    const close = tags.findIndex((u, m) => m > k && u.closing && u.name === 'script');
    out.push({ tag: t, body: html.slice(t.end, close >= 0 ? tags[close].start : html.length) });
  });
  return out;
}

/** The candidate URLs of a `srcset` attribute. */
export function srcsetUrls(srcset: string): string[] {
  return srcset
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** The `<meta name="robots">` contents in a page. */
export function robotsMetas(html: string): string[] {
  return scanTags(html)
    .filter((t) => !t.closing && t.name === 'meta' && (attr(t, 'name') ?? '').toLowerCase() === 'robots')
    .map((t) => attr(t, 'content') ?? '');
}
