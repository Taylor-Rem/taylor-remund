/**
 * GPU time per pass, from EXT_disjoint_timer_query_webgl2 when the browser
 * offers it (Chrome on the reference laptop does). Queries are sequential
 * (WebGL 2 cannot nest them) and read back a few frames later, so the
 * numbers are smoothed averages, not this frame's. When the extension is
 * missing, `available` is false and every call is a no-op; frame-time A/B
 * runs (scripts/perf.ts) are then the way to cost a pass.
 */

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface Pending {
  label: string;
  query: WebGLQuery;
}

export class GpuTimer {
  readonly available: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerExt | null;
  private pending: Pending[] = [];
  private open: Pending | null = null;
  private readonly avg = new Map<string, number>();
  private readonly samples = new Map<string, number[]>();
  enabled = true;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    this.available = this.ext !== null;
  }

  begin(label: string): void {
    if (!this.ext || !this.enabled || this.open) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = { label, query: q };
  }

  end(): void {
    if (!this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }

  /** Collect finished queries. Call once per frame. */
  poll(): void {
    if (!this.ext || this.pending.length === 0) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    const still: Pending[] = [];
    for (const p of this.pending) {
      const ready = gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!ready) {
        still.push(p);
        continue;
      }
      if (!disjoint) {
        const ms = (gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number) / 1e6;
        const prev = this.avg.get(p.label);
        this.avg.set(p.label, prev === undefined ? ms : prev * 0.9 + ms * 0.1);
        let s = this.samples.get(p.label);
        if (!s) this.samples.set(p.label, (s = []));
        s.push(ms);
        if (s.length > 600) s.shift();
      }
      gl.deleteQuery(p.query);
    }
    // Never let a stuck query pile up.
    this.pending = still.length > 64 ? still.slice(-64) : still;
  }

  /** Smoothed milliseconds per label. */
  averages(): Record<string, number> {
    return Object.fromEntries(this.avg);
  }

  /** Median milliseconds per label over the recent samples. */
  medians(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, s] of this.samples) {
      const a = [...s].sort((x, y) => x - y);
      out[k] = a[Math.floor(a.length / 2)] ?? 0;
    }
    return out;
  }

  reset(): void {
    this.avg.clear();
    this.samples.clear();
  }

  dispose(): void {
    for (const p of this.pending) this.gl.deleteQuery(p.query);
    this.pending = [];
  }
}
