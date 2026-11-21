// The one table the checks share: every path of REWRITE.md § 2 and what has
// to stay true of it. Edit here, not in the checks.
//
// Run `node scripts/site.ts` to print the table.

import { isMain } from './lib/cli.ts';

/** The commit on main whose published pages are the record (§ 1, § E8). */
export const LEGACY_COMMIT = 'fa99b13';

/** Hosts that are this site (absolute links to them are internal). */
export const SITE_HOSTS: readonly string[] = ['taylorremund.com', 'www.taylorremund.com'];
export const SITE_ORIGIN = 'https://taylorremund.com';

/**
 * Files of the old site that must not be in the build any more: the
 * stylesheet and script the hand-written pages used. Since P3 (A2) no page is
 * served from legacy/; check-urls fails a page that is a byte-identical copy
 * of its legacy file, and any of these in the output.
 */
export const LEGACY_FILES_GONE: readonly string[] = ['style.css', 'script.js'];

/** What a page's robots meta must be: exactly this content, none at all, or not checked. */
export type Robots = { content: string } | 'none' | 'unchecked';

export interface PageSpec {
  /** URL path as linked (`/resume/`). */
  path: string;
  /** File in the built output that answers it. */
  file: string;
  /** Ids that must exist (`#about` and so on keep working). */
  anchors: readonly string[];
  robots: Robots;
  /** A compliance page: its `.legal` wrapper is checked against legal-reference/. */
  compliance: boolean;
  /** Number of `legal-callout` blocks the page carries (0 for every other page). */
  callouts: number;
  /** Must never be linked from any page nor listed in a sitemap. */
  unlinked: boolean;
  /** Source path of the legacy page (for the parity checks). */
  legacyFile: string | null;
}

const NOINDEX: Robots = { content: 'noindex, follow' };

function page(p: PageSpec): PageSpec {
  return p;
}

export const PAGES: readonly PageSpec[] = [
  page({
    path: '/', file: 'index.html',
    anchors: ['patchlamp', 'services', 'about', 'contact'],
    robots: 'none', compliance: false, callouts: 0, unlinked: false, legacyFile: 'index.html',
  }),
  page({
    path: '/resume/', file: 'resume/index.html',
    anchors: ['about', 'skills', 'projects', 'patchlamp', 'experience', 'contact'],
    robots: 'none', compliance: false, callouts: 0, unlinked: false, legacyFile: 'resume/index.html',
  }),
  page({
    path: '/ai/', file: 'ai/index.html',
    anchors: ['how', 'packages', 'patchlamp', 'why', 'faq', 'contact'],
    robots: 'none', compliance: false, callouts: 0, unlinked: false, legacyFile: 'ai/index.html',
  }),
  page({
    path: '/privacy/', file: 'privacy/index.html', anchors: [],
    robots: NOINDEX, compliance: true, callouts: 1, unlinked: false, legacyFile: 'privacy/index.html',
  }),
  page({
    path: '/terms/', file: 'terms/index.html', anchors: [],
    robots: NOINDEX, compliance: true, callouts: 1, unlinked: false, legacyFile: 'terms/index.html',
  }),
  page({
    path: '/sms/', file: 'sms/index.html', anchors: [],
    robots: 'none', compliance: true, callouts: 1, unlinked: false, legacyFile: 'sms/index.html',
  }),
  page({
    path: '/career-send/', file: 'career-send/index.html', anchors: [],
    robots: NOINDEX, compliance: true, callouts: 0, unlinked: true, legacyFile: 'career-send/index.html',
  }),
  page({
    path: '/404.html', file: '404.html', anchors: [],
    robots: 'unchecked', compliance: false, callouts: 0, unlinked: false, legacyFile: null,
  }),
];

/** Non-page paths of § 2 that must keep answering. */
export const ASSETS: readonly string[] = [
  '/CNAME',
  '/assets/og.png',
  '/assets/taylor.jpg',
  '/assets/exchange-room-1280.jpg',
  '/assets/exchange-room-1280.webp',
  '/assets/exchange-room-640.jpg',
  '/assets/exchange-room-640.webp',
];

/** The domain CNAME must hold. */
export const CNAME_DOMAIN = 'taylorremund.com';

/** The service number /sms/ must show (Twilio 10DLC). */
export const SMS_NUMBER = '(937) 764-4699';

/** Every page's footer links these three. */
export const FOOTER_REQUIRED: readonly string[] = ['/privacy/', '/terms/', '/sms/'];

/**
 * sha256 of each `legal-callout` block as published on main at fa99b13, in
 * page order. Embedded here, not read from legal-reference/, so that editing
 * legal-reference/ can never satisfy check-legal's second check (§ E8).
 */
export const CALLOUT_SHA256: Readonly<Record<string, readonly string[]>> = {
  privacy: ['7c21474d78c4e6b8ef592c4c878aa721893771efa0bdf20231f900fb254871af'],
  terms: ['dc361e5ea27ecab234c31d10313d3792102fe65d00a2416fa6cadc79da1d94e9'],
  sms: ['15dcf5b798d8323e84396568688a3e9a3775d73c9a263ffdfc1db00bc20d760f'],
  'career-send': [],
};

/** The exact opening tag of each compliance page's wrapper. */
export const LEGAL_WRAPPER_OPEN = '<div class="container legal">';

export function compliancePages(): PageSpec[] {
  return PAGES.filter((p) => p.compliance);
}

/** `privacy` for `/privacy/`. */
export function slug(p: PageSpec): string {
  return p.path.replace(/^\/|\/$/g, '');
}

export function pageByPath(path: string): PageSpec | undefined {
  return PAGES.find((p) => p.path === path);
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('usage: node scripts/site.ts\n\nPrints the table of REWRITE.md § 2 paths the checks share. Not a check; exits 0.');
    process.exit(0);
  }
  if (args.length > 0) {
    console.error(`site: unexpected arguments: ${args.join(' ')}\nusage: node scripts/site.ts [--help]`);
    process.exit(2);
  }
  for (const p of PAGES) {
    const robots = typeof p.robots === 'object' ? p.robots.content : p.robots;
    console.log(
      [
        p.path.padEnd(14),
        `file=${p.file}`,
        `anchors=${p.anchors.join(',') || '-'}`,
        `robots=${robots}`,
        p.compliance ? `compliance(callouts=${p.callouts})` : '',
        p.unlinked ? 'unlinked' : '',
      ].filter(Boolean).join('  '),
    );
  }
  for (const a of ASSETS) console.log(a);
}
