import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.integration.test.{ts,tsx}'],
    coverage: { provider: 'v8', include: ['src/shared/**/*.{ts,tsx}', 'src/mocks/**/*.ts'], exclude: ['**/generated/**', '**/*.test.*'] },
  },
});
