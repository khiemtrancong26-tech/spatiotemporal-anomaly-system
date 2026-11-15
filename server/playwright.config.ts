import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['b2.spec.ts', 'b3.spec.ts', 'b4.spec.ts', 'b5.spec.ts'],
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: { ...devices['Desktop Chrome'], headless: true, trace: 'retain-on-failure' },
});
