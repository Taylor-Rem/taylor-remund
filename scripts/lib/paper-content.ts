/**
 * Content that only the paper pages read (`/resume/`, `/ai/`, the case study, the Person data): nothing under
 * `src/workshop/` imports it, so a change to it cannot change a picture of the bench or a baked piece, and the
 * pictures' and the bake table's hashes leave it out (scripts/poster.ts, scripts/bake.ts). Before 2026-11-21
 * they covered all of `src/content/`, and every edit to the résumé's words marked the bench's pictures stale.
 *
 * `tests/unit/checks/check-pictures.test.ts` holds the claim: the day the bench reads one of these (the crates
 * and pallets of a later phase take their labels from the résumé), that test fails and the file leaves this list.
 */
export const PAPER_ONLY_CONTENT: readonly string[] = [
  'src/content/resume.json',
  'src/content/resume.ts',
  'src/content/ai.json',
  'src/content/ai.ts',
  'src/content/case-studies.json',
  'src/content/case-studies.ts',
  'src/content/person.ts',
];
