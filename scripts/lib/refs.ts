// Every URL reference in a built HTML page, and whether the browser would
// fetch it while loading the page (a resource) or only on a click (a link).

import { attr, inlineStyles, scanTags, srcsetUrls } from './html.ts';
import type { Tag } from './html.ts';
import { cssRefs } from './css.ts';

export interface HtmlRef {
  url: string;
  /** Where it was found, for messages: `img[src]`, `link[rel=stylesheet]`, `style url()`. */
  where: string;
  /** True when loading the page fetches it (not a navigation link). */
  resource: boolean;
  /** For resources: what kind, for the budget. */
  as: 'stylesheet' | 'script' | 'modulepreload' | 'image' | 'font' | 'frame' | 'media' | 'hint' | 'other' | 'link';
  /** Set for `<img>` / `<source>` candidates: an id grouping alternatives the browser picks one of. */
  group?: number;
  /** For CSS url() inside @font-face src beyond the first. */
  fontFallback?: boolean;
  /** Lazy-loaded image. */
  lazy?: boolean;
  tag?: Tag;
}

/** Link relations that are not fetched while the page loads. */
const NON_FETCH_RELS = new Set([
  'canonical', 'alternate', 'author', 'me', 'license', 'help', 'search', 'next', 'prev',
  'bookmark', 'external', 'nofollow', 'noopener', 'noreferrer', 'opener', 'tag', 'sitemap',
]);

const META_URL_PROPS = new Set(['og:image', 'og:url', 'og:image:url', 'og:image:secure_url', 'twitter:image']);

export function htmlRefs(html: string): HtmlRef[] {
  const out: HtmlRef[] = [];
  const tags = scanTags(html);
  let group = 0;
  let pictureGroup: number | null = null;
  for (const t of tags) {
    if (t.name === 'picture') {
      pictureGroup = t.closing ? null : ++group;
      continue;
    }
    if (t.closing) continue;
    const a = (n: string): string | undefined => attr(t, n);
    const style = a('style');
    if (style) for (const r of cssRefs(style)) out.push({ url: r.url, where: `${t.name}[style] url()`, resource: true, as: 'image', tag: t });
    switch (t.name) {
      case 'a':
      case 'area': {
        const h = a('href');
        if (h !== undefined) out.push({ url: h, where: `${t.name}[href]`, resource: false, as: 'link', tag: t });
        break;
      }
      case 'link': {
        const h = a('href');
        if (h === undefined) break;
        const rels = (a('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const relName = rels.join(' ') || '(none)';
        const fetched = rels.some((r) => !NON_FETCH_RELS.has(r));
        let as: HtmlRef['as'] = 'other';
        if (rels.includes('stylesheet')) as = 'stylesheet';
        else if (rels.includes('modulepreload')) as = 'modulepreload';
        else if (rels.includes('preconnect') || rels.includes('dns-prefetch')) as = 'hint';
        else if (rels.includes('preload') || rels.includes('prefetch')) {
          const asAttr = (a('as') ?? '').toLowerCase();
          as = asAttr === 'font' ? 'font' : asAttr === 'image' ? 'image' : asAttr === 'style' ? 'stylesheet' : asAttr === 'script' ? 'script' : 'other';
        } else if (rels.some((r) => r.includes('icon'))) as = 'image';
        out.push({ url: h, where: `link[rel=${relName}]`, resource: fetched, as: fetched ? as : 'link', tag: t });
        const ss = a('imagesrcset');
        if (ss) for (const u of srcsetUrls(ss)) out.push({ url: u, where: `link[imagesrcset]`, resource: fetched, as: 'image', tag: t });
        break;
      }
      case 'script': {
        const s = a('src');
        if (s !== undefined) out.push({ url: s, where: 'script[src]', resource: true, as: 'script', tag: t });
        break;
      }
      case 'img':
      case 'source': {
        const g = pictureGroup ?? ++group;
        const lazy = (a('loading') ?? '').toLowerCase() === 'lazy';
        const media = t.name === 'source' && pictureGroup === null; // <source> in <video>/<audio>
        const s = a('src');
        if (s !== undefined) out.push({ url: s, where: `${t.name}[src]`, resource: true, as: media ? 'media' : 'image', group: g, lazy, tag: t });
        const ss = a('srcset');
        if (ss) for (const u of srcsetUrls(ss)) out.push({ url: u, where: `${t.name}[srcset]`, resource: true, as: 'image', group: g, lazy, tag: t });
        break;
      }
      case 'iframe':
      case 'frame': {
        const s = a('src');
        if (s !== undefined) out.push({ url: s, where: `${t.name}[src]`, resource: true, as: 'frame', tag: t });
        break;
      }
      case 'video':
      case 'audio':
      case 'track':
      case 'embed': {
        const s = a('src');
        if (s !== undefined) out.push({ url: s, where: `${t.name}[src]`, resource: true, as: 'media', tag: t });
        const p = a('poster');
        if (p !== undefined) out.push({ url: p, where: `${t.name}[poster]`, resource: true, as: 'image', tag: t });
        break;
      }
      case 'object': {
        const d = a('data');
        if (d !== undefined) out.push({ url: d, where: 'object[data]', resource: true, as: 'other', tag: t });
        break;
      }
      case 'input': {
        const s = a('src');
        if (s !== undefined && (a('type') ?? '').toLowerCase() === 'image') out.push({ url: s, where: 'input[src]', resource: true, as: 'image', tag: t });
        break;
      }
      case 'use':
      case 'image': {
        // SVG <use href> / <image href> (and the old xlink:href)
        const h = a('href') ?? a('xlink:href');
        if (h !== undefined) out.push({ url: h, where: `${t.name}[href]`, resource: true, as: 'image', tag: t });
        break;
      }
      case 'meta': {
        const prop = (a('property') ?? a('name') ?? '').toLowerCase();
        const c = a('content');
        if (c !== undefined && META_URL_PROPS.has(prop)) out.push({ url: c, where: `meta[${prop}]`, resource: false, as: 'link', tag: t });
        break;
      }
    }
  }
  for (const css of inlineStyles(html)) {
    for (const r of cssRefs(css)) {
      out.push({
        url: r.url,
        where: r.kind === 'import' ? 'style @import' : 'style url()',
        resource: true,
        as: r.kind === 'import' ? 'stylesheet' : 'other',
        fontFallback: r.fontFallback,
      });
    }
  }
  return out;
}
