// The scripts run as `node scripts/<name>.ts`: native type stripping, exit
// codes 0 pass / 1 fail / 2 usage error, --help.

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO, edit, makeSite, tmp, write } from './helpers.ts';

function run(name: string, args: string[]): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', `${name}.ts`), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const DIST_CHECKS = ['check-urls', 'check-legal', 'check-links', 'budget'];
const SOURCE_CHECKS = ['check-layers', 'check-look', 'check-claims'];

describe('command line', () => {
  it.each([...DIST_CHECKS, ...SOURCE_CHECKS])('%s --help prints usage and exits 0', (name) => {
    const r = run(name, ['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(new RegExp(`usage: node scripts/${name}\\.ts`));
    expect(r.err).not.toMatch(/ExperimentalWarning|SyntaxError/);
  });

  it.each([...DIST_CHECKS, ...SOURCE_CHECKS])('%s exits 2 on an unknown option', (name) => {
    expect(run(name, ['--bogus']).code).toBe(2);
  });

  it('site.ts prints the table, and --help', () => {
    expect(run('site', []).out).toMatch(/\/career-send\/ .*unlinked/);
    expect(run('site', ['--help']).code).toBe(0);
    expect(run('site', ['--x']).code).toBe(2);
  });

  it('the dist checks pass on a good site (exit 0) and fail on a broken one (exit 1)', () => {
    const s = makeSite();
    for (const name of DIST_CHECKS) {
      const ok = run(name, ['--dist', s.dist, '--root', s.root]);
      expect(ok.code, `${name}\n${ok.out}${ok.err}`).toBe(0);
      expect(ok.out.trim().split('\n').pop()).toBe(`PASS ${name}`);
    }
    // One fault per check.
    edit(join(s.dist, 'index.html'), 'id="about"', 'id="bio"'); // urls: missing anchor
    edit(join(s.dist, 'terms/index.html'), 'STOP', 'S7OP'); // legal
    edit(join(s.dist, 'sms/index.html'), '<a href="/">Home</a>', '<a href="/gone/">x</a>'); // links
    edit(join(s.dist, 'privacy/index.html'), '</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head>'); // budget
    for (const name of DIST_CHECKS) {
      const bad = run(name, ['--dist', s.dist, '--root', s.root]);
      expect(bad.code, `${name}\n${bad.out}`).toBe(1);
      expect(bad.out.trim().split('\n').pop()).toMatch(new RegExp(`^FAIL ${name}: \\d+ problems?$`));
    }
  });

  it('a missing dist is a failure, not a pass', () => {
    for (const name of DIST_CHECKS) {
      const r = run(name, ['--dist', join(tmp('none-'), 'dist')]);
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/build output not found/);
    }
  });

  it('the source checks exit 0 on an empty tree and 1 on a violation', () => {
    const root = tmp('src-');
    for (const name of SOURCE_CHECKS) expect(run(name, ['--root', root, '--dist', 'ignored']).code).toBe(0);
    write(join(root, 'src/workshop/sim/a.ts'), `import * as THREE from 'three';\nexport const c = new THREE.BoxGeometry(); export const r = Math.random(); export const h = '#ff0000';`);
    write(join(root, 'src/content/a.json'), '{"x": {"text": "t", "kind": "fact"}}');
    for (const name of SOURCE_CHECKS) {
      const r = run(name, ['--root', root]);
      expect(r.code, `${name}\n${r.out}`).toBe(1);
    }
  });
});
