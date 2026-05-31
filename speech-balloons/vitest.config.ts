import { defineConfig } from 'vitest/config';

// Standalone vitest config — kept separate from vite.config.ts so the test
// runner doesn't pull in app-only plugins (React, etc.). These suites are
// pure-math, so a plain Node environment is enough.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
