import { defineConfig, devices } from '@playwright/test';

function port(value: string | undefined, fallback: number) {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error('Invalid E2E port.');
  return result;
}
const mockPort = port(process.env.PM25_E2E_MOCK_PORT, 5173);
const onlinePort = port(process.env.PM25_E2E_ONLINE_PORT, 4173);
const mockUrl = `http://127.0.0.1:${mockPort}`, onlineUrl = `http://127.0.0.1:${onlinePort}`;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: mockUrl, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium-mock', testMatch: 'mock-application-workflows.spec.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-online', testMatch: ['online-api-workflows.spec.ts', 'space-time-cube.spec.ts', 'analyst-exploration-and-review.spec.ts', 'map-cube-state-sharing.spec.ts'], use: { ...devices['Desktop Chrome'], baseURL: onlineUrl } },
  ],
  webServer: [
    { command: `npm run dev:mock -- --port ${mockPort}`, url: mockUrl, reuseExistingServer: false },
    { command: `npm run preview -- --port ${onlinePort}`, url: onlineUrl, reuseExistingServer: false },
  ],
});
