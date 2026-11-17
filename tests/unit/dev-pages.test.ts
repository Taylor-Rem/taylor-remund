import { describe, expect, it } from 'vitest';
import { devPagePattern, devPagesEnabled } from '../../integrations/dev-pages.ts';

describe('dev pages', () => {
  it('are on in astro dev, off in a build unless WORKSHOP_DEV_PAGES=1', () => {
    expect(devPagesEnabled('dev', {})).toBe(true);
    expect(devPagesEnabled('build', {})).toBe(false);
    expect(devPagesEnabled('build', { WORKSHOP_DEV_PAGES: '0' })).toBe(false);
    expect(devPagesEnabled('build', { WORKSHOP_DEV_PAGES: '1' })).toBe(true);
  });

  it('map files to /dev/ routes', () => {
    expect(devPagePattern('index.astro')).toBe('/dev');
    expect(devPagePattern('kit.astro')).toBe('/dev/kit');
    expect(devPagePattern('kit/index.astro')).toBe('/dev/kit');
    expect(devPagePattern('kit/crate.astro')).toBe('/dev/kit/crate');
    expect(devPagePattern('reindex.astro')).toBe('/dev/reindex');
  });
});
