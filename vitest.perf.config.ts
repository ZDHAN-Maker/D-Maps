import { defineConfig } from 'vitest/config';

// Separate from the unit-test config so timing runs never block `npm test`.
export default defineConfig({
  test: { environment: 'node', include: ['tests/perf/**/*.perf.ts'], testTimeout: 120_000 },
});
