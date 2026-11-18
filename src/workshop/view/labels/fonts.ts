/**
 * The world's four typefaces, self-hosted under public/fonts/ (see the
 * README.txt there for sources and licences). They are loaded with the
 * FontFace API before anything is drawn; a texture drawn in a fallback face
 * is a bug, so a missing face or a missing glyph throws.
 */

export type FaceRole = 'tape' | 'stencil' | 'type' | 'sign';

export interface FaceSpec {
  family: string;
  file: string;
  /** What it is a subset of (for error messages and the dev page). */
  from: string;
}

export const FACES: Record<FaceRole, FaceSpec> = {
  // Label tape, engraved plates, the phone: a slightly rounded semi-condensed grotesk.
  tape: { family: 'Workshop Tape', file: 'workshop-tape.woff2', from: 'Barlow Semi Condensed SemiBold' },
  // Crate stencils: a true stencil face with bridges.
  stencil: { family: 'Workshop Stencil', file: 'workshop-stencil.woff2', from: 'Stardos Stencil Bold' },
  // Printed cards and slips: a narrow slab monospace, like a teletype or receipt printer.
  type: { family: 'Workshop Print', file: 'workshop-print.woff2', from: 'Iosevka Fixed Slab Medium' },
  // The hand-painted sign: a sturdy slab.
  sign: { family: 'Workshop Sign', file: 'workshop-sign.woff2', from: 'Alfa Slab One' },
};

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const CAPS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;-–—'’\"!?&/#()+%*";

/**
 * The characters each subset holds (public/fonts/README.txt has the command
 * that made them). A unit test checks every world string against these, so
 * a missing glyph fails in Node before it can fall back in a browser.
 */
export const SUBSET: Record<FaceRole, string> = {
  tape: ASCII + '’‘“”–—…é',
  type: ASCII + '’‘“”–—…é',
  stencil: CAPS,
  sign: CAPS,
};

/** CSS font shorthand for a role at a pixel size. Never lists a fallback family on purpose. */
export function font(role: FaceRole, px: number): string {
  return `${px.toFixed(2)}px "${FACES[role].family}"`;
}

export class FontFallbackError extends Error {
  override name = 'FontFallbackError';
}

let loading: Promise<void> | null = null;
/** The faces' bytes, once loaded (handed to the label workers, so they do not fetch them again). */
const bytes = new Map<string, ArrayBuffer>();

/** The loaded faces' files, by family (empty until loadFonts has resolved). */
export function fontBytes(): ReadonlyMap<string, ArrayBuffer> {
  return bytes;
}

/** Load every face once. Rejects (loudly) if any face fails to load. */
export function loadFonts(base = '/fonts/'): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    // the bytes first (kept for the workers), then the faces from them: the same files as a url() face
    const files = await Promise.allSettled(
      Object.values(FACES).map(async (f) => {
        const r = await fetch(`${base}${f.file}`);
        if (!r.ok) throw new Error(`${r.status}`);
        return r.arrayBuffer();
      }),
    );
    const faces = Object.values(FACES).map((f, i) => {
      const r = files[i]!;
      return r.status === 'fulfilled' ? new FontFace(f.family, r.value, { display: 'block' }) : null;
    });
    const results = await Promise.allSettled(faces.map((f) => (f ? f.load() : Promise.reject(new Error('fetch failed')))));
    const failed = results.map((r, i) => (r.status === 'rejected' ? Object.values(FACES)[i]!.family : null)).filter(Boolean);
    if (failed.length) throw new FontFallbackError(`labels: font(s) failed to load: ${failed.join(', ')}`);
    Object.values(FACES).forEach((f, i) => bytes.set(f.family, (files[i] as PromiseFulfilledResult<ArrayBuffer>).value));
    for (const f of faces) document.fonts.add(f!);
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Characters of `text` that would NOT be drawn in the role's face (missing
 * from the subset, or the face is not loaded): measured once against a
 * monospace fallback and once against a serif one; a glyph from the face
 * itself measures the same both times.
 */
export function fallbackChars(ctx: Ctx2D, role: FaceRole, text: string): string[] {
  const fam = FACES[role].family;
  const bad: string[] = [];
  for (const ch of new Set([...text])) {
    if (ch === ' ' || ch === '\n') continue;
    ctx.font = `64px "${fam}", monospace`;
    const a = ctx.measureText(ch).width;
    ctx.font = `64px "${fam}", serif`;
    const b = ctx.measureText(ch).width;
    if (Math.abs(a - b) > 0.01) bad.push(ch);
  }
  return bad;
}

/** Throw if any character of `text` would be drawn in a fallback face. */
export function assertFace(ctx: Ctx2D, role: FaceRole, text: string): void {
  const bad = fallbackChars(ctx, role, text);
  if (bad.length) {
    throw new FontFallbackError(`labels: ${JSON.stringify(bad.join(''))} in ${JSON.stringify(text)} is not in ${FACES[role].family} (${FACES[role].from} subset); add it to the subset in public/fonts/ or change the text`);
  }
}
