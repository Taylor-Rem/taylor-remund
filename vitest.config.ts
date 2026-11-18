import { defineConfig } from 'vitest/config';

// Unit and headless-simulation tests run in Node (REWRITE.md § E8).
// tests/browser/ belongs to Playwright and is never collected here.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/scenario/**/*.test.ts'],
    environment: 'node',
    // Headless physics scenarios are heavy, and verify often runs while other work
    // loads the machine: the default 5 s per test turns load into false failures.
    // Generous on purpose: the seeded history and soak runs take 15 s alone and several times that when
    // the machine is shared; a timeout here must mean a hang, never a busy laptop.
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
