/**
 * GPU time per pass, from EXT_disjoint_timer_query_webgl2 when the browser
 * offers it (Chrome on the reference laptop does). Queries are sequential
 * (WebGL 2 cannot nest them) and read back a few frames later, so the
 * numbers are smoothed averages, not this frame's. When the extension is
 * missing, `available` is false and every call is a no-op; frame-time A/B
 * runs (scripts/perf.ts) are then the way to cost a pass.
 *
 * A label may be timed more than once in a frame (`split` closes the open
 * query and opens another, so a pass nested inside another, the shadow map
 * inside the scene draw, gets its own figure): samples are per frame, the
 * sum of that label's queries in it.
 */

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface Pending {
  label: string;
  query: WebGLQuery;
  frame: number;
}

export class GpuTimer {
  readonly available: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerExt | null;
  private pending: Pending[] = [];
  private open: Pending | null = null;
  private frame = 0;
  /** The frame whose finished queries are being summed, and the sums. */
  private accFrame = -1;
  private acc = new Map<string, number>();
  private readonly avg = new Map<string, number>();
  private readonly samples = new Map<string, number[]>();
  enabled = true;
  /**
   * Discard a poll's results when the GPU reports a disjoint (default). On the reference
   * laptop (RADV) disjoints are frequent; an A/B harness that compares interleaved frames
   * may set this false and keep them.
   */
  strict = true;
  /** Polls that reported a disjoint (their results are discarded when `strict`). */
  disjoints = 0;
  /** Measurement: called with each completed frame's milliseconds per label (A/B harnesses). */
  onFrame: ((frame: number, ms: Readonly<Record<string, number>>) => void) | null = null;

  /** The number of the frame being timed now (poll() starts a new one). */
  get frameNo(): number {
    return this.frame;
  }

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
    this.open = { label, query: q, frame: this.frame };
  }

  /** Close the open query (if any) and open one under `label`. */
  split(label: string): void {
    if (!this.ext || !this.enabled) return;
    this.end();
    this.begin(label);
  }

  /** The label of the open query, if any (to resume it after a split). */
  get current(): string | null {
    return this.open?.label ?? null;
  }

  end(): void {
    if (!this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }

  private flush(): void {
    if (this.onFrame && this.acc.size) this.onFrame(this.accFrame, Object.fromEntries(this.acc));
    for (const [label, ms] of this.acc) {
      const prev = this.avg.get(label);
      this.avg.set(label, prev === undefined ? ms : prev * 0.9 + ms * 0.1);
      let s = this.samples.get(label);
      if (!s) this.samples.set(label, (s = []));
      s.push(ms);
      if (s.length > 600) s.shift();
    }
    this.acc.clear();
  }

  /** Collect finished queries. Call once per frame, before the frame's first query. */
  poll(): void {
    this.frame++;
    if (!this.ext || this.pending.length === 0) return;
    const gl = this.gl;
    const raw = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    if (raw) this.disjoints++;
    const disjoint = raw && this.strict;
    const still: Pending[] = [];
    // queries finish in order: stop at the first that is not ready
    let blocked = false;
    for (const p of this.pending) {
      const ready = !blocked && (gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE) as boolean);
      if (!ready) {
        blocked = true;
        still.push(p);
        continue;
      }
      if (p.frame !== this.accFrame) {
        this.flush();
        this.accFrame = p.frame;
      }
      if (!disjoint) {
        const ms = (gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number) / 1e6;
        this.acc.set(p.label, (this.acc.get(p.label) ?? 0) + ms);
      }
      gl.deleteQuery(p.query);
    }
    // a frame is complete once nothing of it is still pending
    if (still.length === 0 || still[0]!.frame !== this.accFrame) this.flush();
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
    this.acc.clear();
    this.avg.clear();
    this.samples.clear();
  }

  dispose(): void {
    for (const p of this.pending) this.gl.deleteQuery(p.query);
    this.pending = [];
  }
}
