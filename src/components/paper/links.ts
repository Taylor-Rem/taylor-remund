/**
 * Link helpers for the paper pages: what a printed page shows after a link
 * (its address, derived from the href; never new words), and the attributes
 * an outside link gets.
 */
/** This site, for the printed address of a root-relative link. */
export const SITE_ORIGIN = 'https://taylorremund.com';

/**
 * The address a printed page shows after a link, or null when a reader of
 * paper does not need one (a link within this page or to the home page's
 * sections). `mailto:a@b?subject=x` → `a@b`; `https://www.x.com/p` → `x.com/p`;
 * `/case-studies/x/` → `taylorremund.com/case-studies/x/`.
 */
export function printAddress(href: string): string | null {
  if (href.startsWith('#') || href.startsWith('/#') || href === '/') return null;
  if (href.startsWith('mailto:')) return href.slice('mailto:'.length).split('?')[0] ?? null;
  if (href.startsWith('/')) return `${SITE_ORIGIN.replace(/^https?:\/\//, '')}${href}`;
  const m = /^https?:\/\/(?:www\.)?(.*?)\/?$/.exec(href);
  return m ? (m[1] ?? null) : null;
}

/** `data-print` for a link, when it has a print address that its text does not already say. */
export function printAttrs(href: string, text?: string): Record<string, string> {
  const a = printAddress(href);
  return a === null || a === text ? {} : { 'data-print': a };
}

/** A link that leaves this site opens as the live page opened it: a new tab, `noopener`. */
export function externalAttrs(href: string): Record<string, string> {
  return /^https?:\/\//.test(href) ? { target: '_blank', rel: 'noopener' } : {};
}
