import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** Files run strictly in name order (01-…, 02-…): later suites build on accounts created earlier. */
class ByName extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

// Integration tests: sequential, against local workerd (scripts/test-integration.sh).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false, sequencer: ByName },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
