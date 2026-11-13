import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-mock', testMatch: 'foundation.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-online', testMatch: 'online.spec.ts', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' } },
  ],
  webServer: [
    { command: 'npm run dev:mock', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
    { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  ],
});
