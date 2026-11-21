import { describe, expect, it } from 'vitest';
import { contrast, mix, paperColours, tokensCss } from '../../../src/styles/paper-tokens.ts';
import { palette } from '../../../src/workshop/view/palette.ts';

describe('paper tokens', () => {
  it('take paper and ink from the workshop palette', () => {
    expect(paperColours.paper).toBe(palette.paper);
    expect(paperColours.ink).toBe(palette.ink);
    expect(paperColours.link).toBe(palette['teal-panel']);
  });

  it('mix two tokens in sRGB', () => {
    expect(mix('ink', 'paper', 1)).toBe(palette.ink);
    expect(mix('ink', 'paper', 0)).toBe(palette.paper);
  });

  it.each([
    ['ink on paper', 'ink', 'paper'],
    ['ink-soft on paper', 'ink-soft', 'paper'],
    ['link on paper', 'link', 'paper'],
    ['mark on paper', 'mark', 'paper'],
    ['paper on ink (the label tape)', 'paper', 'ink'],
    ['ink on paper-deep (callouts, code)', 'ink', 'paper-deep'],
    ['ink-soft on paper-deep', 'ink-soft', 'paper-deep'],
    ['link on paper-deep', 'link', 'paper-deep'],
  ] as const)('%s is at least 4.5:1', (_label, fg, bg) => {
    expect(contrast(paperColours[fg], paperColours[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('emit one :root rule of custom properties', () => {
    const css = tokensCss();
    expect(css.startsWith(':root{--paper:#')).toBe(true);
    for (const k of Object.keys(paperColours)) expect(css).toContain(`--${k}:`);
  });
});
