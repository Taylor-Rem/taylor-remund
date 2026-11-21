/**
 * The small inline form a paragraph in src/content/*.json may use, and the
 * ONE function that turns it into HTML. Everything that is not one of these
 * marks is escaped, so content can never inject markup.
 *
 *   `code`          <code>code</code>
 *   **bold**        <strong>bold</strong>
 *   *em*            <em>em</em>
 *   [text](href)    <a href="href">text</a>   (text may hold `code`, **bold**, *em*)
 *   \` \* \[ \] \( \) \\   the character itself
 *
 * An unclosed mark is an error (the build stops), not a guess.
 */

export interface InlineOptions {
  /** Extra attributes for each link, from its href (e.g. a print address). */
  linkAttrs?: (href: string) => Record<string, string>;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

function attrs(a: Record<string, string>): string {
  return Object.entries(a).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
}

class InlineError extends Error {}

/** Renders the inline form to HTML. Throws on an unclosed or malformed mark. */
export function renderInline(src: string, opts: InlineOptions = {}): string {
  try {
    return parse(src, 0, '', opts).html;
  } catch (e) {
    if (e instanceof InlineError) throw new Error(`inline: ${e.message} in ${JSON.stringify(src)}`);
    throw e;
  }
}

/** The plain text a reader sees (marks removed, link texts kept). */
export function inlineText(src: string): string {
  return renderInline(src)
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[n]!);
}

/** Parses from `i` until `stop` (a closing mark) or the end; returns the HTML and the index after `stop`. */
function parse(s: string, i: number, stop: string, opts: InlineOptions): { html: string; next: number } {
  let out = '';
  while (i < s.length) {
    if (stop && s.startsWith(stop, i) && !(stop === '*' && s.startsWith('**', i))) {
      return { html: out, next: i + stop.length };
    }
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && '`*[]()\\'.includes(s[i + 1]!)) {
      out += escapeHtml(s[i + 1]!);
      i += 2;
    } else if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end < 0) throw new InlineError('unclosed `');
      out += `<code>${escapeHtml(s.slice(i + 1, end))}</code>`;
      i = end + 1;
    } else if (s.startsWith('**', i)) {
      const inner = parse(s, i + 2, '**', opts);
      out += `<strong>${inner.html}</strong>`;
      i = inner.next;
    } else if (c === '*') {
      const inner = parse(s, i + 1, '*', opts);
      out += `<em>${inner.html}</em>`;
      i = inner.next;
    } else if (c === '[') {
      const text = parse(s, i + 1, ']', opts);
      if (s[text.next] !== '(') throw new InlineError('a [link] needs (href) right after it');
      const end = s.indexOf(')', text.next);
      if (end < 0) throw new InlineError('unclosed (href');
      const href = s.slice(text.next + 1, end);
      if (href.trim() === '' || /\s/.test(href)) throw new InlineError(`bad href ${JSON.stringify(href)}`);
      out += `<a href="${escapeHtml(href)}"${attrs(opts.linkAttrs?.(href) ?? {})}>${text.html}</a>`;
      i = end + 1;
    } else if (c === ']') {
      throw new InlineError('a ] with no [');
    } else {
      out += escapeHtml(c);
      i += 1;
    }
  }
  if (stop) throw new InlineError(`unclosed ${stop === ']' ? '[' : stop}`);
  return { html: out, next: i };
}
