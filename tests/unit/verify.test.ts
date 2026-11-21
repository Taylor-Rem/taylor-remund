import { describe, expect, it } from 'vitest';
import { CHECKS, STEPS, UsageError, formatResult, parseArgs, runStep, selectSteps } from '../../scripts/verify.ts';

const names = (steps: { name: string }[]) => steps.map((s) => s.name);

describe('verify: the step list', () => {
  it('runs typecheck, unit, build, then the ten checks, in that order', () => {
    expect(names([...STEPS])).toEqual(['typecheck', 'unit', 'build', ...CHECKS]);
    expect(CHECKS).toEqual(['check-urls', 'check-legal', 'check-links', 'budget', 'check-layers', 'check-look', 'check-claims', 'check-text', 'check-prose', 'check-pictures']);
  });

  it('runs each check as node scripts/<name>.ts --dist dist and requires the file', () => {
    const urls = STEPS.find((s) => s.name === 'check-urls')!;
    expect(urls.command).toEqual(['node', 'scripts/check-urls.ts', '--dist', 'dist']);
    expect(urls.requires).toBe('scripts/check-urls.ts');
  });
});

describe('verify: parseArgs', () => {
  it('defaults', () => {
    expect(parseArgs([])).toEqual({ keepGoing: false, only: null, skip: [] });
  });

  it('reads --keep-going, --only and --skip, spaced or with =', () => {
    expect(parseArgs(['--keep-going', '--only', 'build,unit', '--skip=budget'])).toEqual({
      keepGoing: true,
      only: ['build', 'unit'],
      skip: ['budget'],
    });
  });

  it('accumulates repeated lists and ignores empty items', () => {
    expect(parseArgs(['--skip', 'a,', '--skip', 'b']).skip).toEqual(['a', 'b']);
  });

  it('rejects unknown flags and a flag with no list', () => {
    expect(() => parseArgs(['--fast'])).toThrow(UsageError);
    expect(() => parseArgs(['--only'])).toThrow(UsageError);
    expect(() => parseArgs(['--only', '--keep-going'])).toThrow(UsageError);
  });
});

describe('verify: selectSteps', () => {
  it('selects everything by default', () => {
    expect(names(selectSteps(STEPS, { only: null, skip: [] }))).toEqual(names([...STEPS]));
  });

  it('--only keeps canonical order, not the order given', () => {
    expect(names(selectSteps(STEPS, { only: ['check-urls', 'typecheck', 'build'], skip: [] }))).toEqual([
      'typecheck',
      'build',
      'check-urls',
    ]);
  });

  it('--skip removes steps', () => {
    expect(names(selectSteps(STEPS, { only: null, skip: [...CHECKS] }))).toEqual(['typecheck', 'unit', 'build']);
  });

  it('--only and --skip combine', () => {
    expect(names(selectSteps(STEPS, { only: ['unit', 'build'], skip: ['build'] }))).toEqual(['unit']);
  });

  it('an unknown step name is an error, so a typo cannot skip nothing silently', () => {
    expect(() => selectSteps(STEPS, { only: null, skip: ['check-url'] })).toThrow(/check-url/);
    expect(() => selectSteps(STEPS, { only: ['bulid'], skip: [] })).toThrow(UsageError);
  });
});

describe('verify: running', () => {
  it('a missing check script is a FAIL, not a skip', () => {
    const result = runStep({ name: 'x', command: ['node', 'nope.ts'], requires: 'scripts/does-not-exist.ts' }, process.cwd());
    expect(result).toMatchObject({ ok: false, note: 'missing scripts/does-not-exist.ts' });
    expect(formatResult(result)).toMatch(/^FAIL {2}x /);
  });

  it('passes and fails on the exit status', () => {
    expect(runStep({ name: 'ok', command: ['node', '-e', ''] }, process.cwd()).ok).toBe(true);
    expect(runStep({ name: 'bad', command: ['node', '-e', 'process.exit(3)'] }, process.cwd())).toMatchObject({ ok: false, note: 'exit 3' });
  });
});
