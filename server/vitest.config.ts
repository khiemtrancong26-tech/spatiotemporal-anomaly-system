import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.integration.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 180_000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/main.ts'] },
  },
});
