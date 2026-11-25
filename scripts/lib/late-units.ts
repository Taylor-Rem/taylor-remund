// (E1) The files that are a late unit's own: a crew member who arrives after the bench is usable (shell/late.ts), in a
// chunk of his own (astro.config's `late-*` groups). They never draw the loading pictures (he is never in them: he
// makes his entrance after the swap) and none of his pieces is in the bake table (they bake live as he arrives), so
// the hashes those are checked against (scripts/poster.ts, scripts/bake.ts) leave them out: a change to him alone
// never makes the pictures stale. One list, kept with astro.config's group for the same unit.

/** Paths relative to the repository root, posix separators. */
export const LATE_UNIT_FILES: readonly RegExp[] = [
  /^src\/workshop\/view\/kit\/pieces\/pitch\//,
  /^src\/workshop\/view\/stations\/pitch\.ts$/,
  /^src\/workshop\/view\/late\/pitch\.ts$/,
  /^src\/workshop\/sim\/crew\/pitch\.ts$/,
  /^src\/workshop\/sim\/scenes\/bench-pitch\.ts$/,
];

export const isLateUnitFile = (rel: string): boolean => LATE_UNIT_FILES.some((re) => re.test(rel.split('\\').join('/')));
