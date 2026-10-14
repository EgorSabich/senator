import { defineConfig } from 'vitest/config';

// Unit tests run in Node without the Cloudflare plugin.
// Database/worker checks run against local workerd: scripts/smoke-local.sh.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
