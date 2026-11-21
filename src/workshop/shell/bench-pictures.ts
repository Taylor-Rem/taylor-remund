/**
 * The bench's loading pictures (B1; P3 B1): ONE set, shared by `/` and
 * `/dev/bench/` (same bench, same framing). The files live in
 * `src/assets/bench/`, rendered by
 *
 *   node scripts/poster.ts --set src/assets/bench/posters.json --page /
 *
 * and committed. A page hands these to StageHead (the preloads) and
 * StagePicture (the <picture>):
 *
 *   <StageHead posters={{ set: BENCH_POSTERS, files: BENCH_POSTER_FILES, dir: BENCH_POSTER_DIR }} … />
 *   <StagePicture set={BENCH_POSTERS} files={BENCH_POSTER_FILES} dir={BENCH_POSTER_DIR} />
 */
import type { PosterSet } from './poster.ts';
import postersJson from '../../assets/bench/posters.json';

/** The set: bands, the camera each was rendered from, the files. */
export const BENCH_POSTERS = postersJson as unknown as PosterSet;
/** Each file's built URL, keyed as `${BENCH_POSTER_DIR}${file}`. */
export const BENCH_POSTER_FILES = import.meta.glob<string>('../../assets/bench/*.{avif,jpg}', { query: '?url', import: 'default', eager: true });
export const BENCH_POSTER_DIR = '../../assets/bench/';
/** Where the set lives in the repository (scripts/poster.ts, the unit tests). */
export const BENCH_POSTERS_PATH = 'src/assets/bench/posters.json';
