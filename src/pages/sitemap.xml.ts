// /sitemap.xml (REWRITE.md § F1): the indexable pages only. Never /privacy/,
// /terms/ (both noindex), /career-send/ (unlinked) or the 404;
// scripts/check-urls.ts fails the build's check if one appears.
//
// To add a page: one line in INDEXABLE.
import type { APIRoute } from 'astro';

export const INDEXABLE: readonly string[] = ['/', '/resume/', '/ai/', '/sms/', '/case-studies/ledger-repair/'];

const ORIGIN = 'https://taylorremund.com';

export const GET: APIRoute = () => {
  const urls = INDEXABLE.map((p) => `  <url><loc>${new URL(p, ORIGIN).href}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
