// The global setup of playwright.config.ts: a private X display for headed Firefox, the only way Firefox gets
// WebGL on this machine (the config's header says why). Started for the run when Xvfb is installed, whatever
// $DISPLAY says (never a window on a real desktop), and stopped when the run ends. The workers inherit DISPLAY.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Where Xvfb is, or null. */
export function xvfbPath(): string | null {
  for (const p of ['/usr/bin/Xvfb', '/usr/local/bin/Xvfb']) if (existsSync(p)) return p;
  return null;
}

export default async function globalSetup(): Promise<(() => Promise<void>) | void> {
  const bin = xvfbPath();
  if (!bin) return;
  // -displayfd: Xvfb picks a free display number and writes it to fd 3 once it is ready
  const child: ChildProcess = spawn(bin, ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
  const display = await new Promise<string>((resolve, reject) => {
    let got = '';
    const timer = setTimeout(() => reject(new Error('display: Xvfb did not start within 10 s')), 10_000);
    child.stdio[3]!.on('data', (d: Buffer) => {
      got += d.toString();
      if (got.includes('\n')) {
        clearTimeout(timer);
        resolve(`:${got.trim()}`);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`display: Xvfb exited (${code}) before it was ready`));
    });
  });
  process.env.DISPLAY = display;
  const stop = (): void => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  process.once('exit', stop);
  return async () => stop();
}
