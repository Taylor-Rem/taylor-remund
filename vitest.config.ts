import { defineConfig } from 'vitest/config';

// Unit and headless-simulation tests run in Node (REWRITE.md § E8).
// tests/browser/ belongs to Playwright and is never collected here.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/scenario/**/*.test.ts'],
    environment: 'node',
  },
});
