// Checked indexing. Under `noUncheckedIndexedAccess` an index is `T | undefined`;
// where an undefined would be a bug in the check itself, fail loudly rather
// than skip a comparison (a check must never pass vacuously).

/** `xs[i]`, or throws when `i` is out of range. */
export function at<T>(xs: readonly T[], i: number, what = 'index'): T {
  const v = xs[i];
  if (v === undefined) throw new Error(`internal: ${what} ${i} out of range (length ${xs.length})`);
  return v;
}

/** Capture group `i` of a regex match, or throws when it did not participate. */
export function group(m: RegExpExecArray | RegExpMatchArray, i: number): string {
  const v = m[i];
  if (v === undefined) throw new Error(`internal: regex group ${i} missing in ${JSON.stringify(m[0])}`);
  return v;
}
