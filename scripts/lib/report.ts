// A check's findings, collected so tests can read them and main() can print
// them. One line per finding; the PASS/FAIL summary is printed last.

export type Level = 'FAIL' | 'ok' | 'NOTE' | 'EXEMPT' | 'INFO';

export interface Line {
  level: Level;
  text: string;
}

export class Report {
  name: string;
  lines: Line[] = [];

  constructor(name: string) {
    this.name = name;
  }

  fail(text: string): void {
    this.lines.push({ level: 'FAIL', text });
  }
  ok(text: string): void {
    this.lines.push({ level: 'ok', text });
  }
  note(text: string): void {
    this.lines.push({ level: 'NOTE', text });
  }
  exempt(text: string): void {
    this.lines.push({ level: 'EXEMPT', text });
  }
  info(text: string): void {
    this.lines.push({ level: 'INFO', text });
  }

  get failures(): string[] {
    return this.lines.filter((l) => l.level === 'FAIL').map((l) => l.text);
  }
  get passed(): boolean {
    return this.failures.length === 0;
  }
  get exitCode(): number {
    return this.passed ? 0 : 1;
  }

  /** Every line as printed, without the summary. */
  render(): string {
    return this.lines
      .map((l) => (l.level === 'INFO' ? l.text : `${l.level.padEnd(6)} ${l.text}`))
      .join('\n');
  }

  summary(): string {
    const n = this.failures.length;
    return n === 0 ? `PASS ${this.name}` : `FAIL ${this.name}: ${n} problem${n === 1 ? '' : 's'}`;
  }

  print(): void {
    const body = this.render();
    if (body) console.log(body);
    console.log(this.summary());
  }
}
