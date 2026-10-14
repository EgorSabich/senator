import { defineConfig } from 'vitest/config';

// Integration tests: sequential, against local workerd (scripts/test-integration.sh).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
