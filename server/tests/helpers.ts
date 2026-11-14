import { loadConfig } from '../src/config.js';

export const testSecret = 'B2-test-only-secret-at-least-32-bytes-never-use-in-production';
export function loadTestConfig(env: NodeJS.ProcessEnv = {}) {
  return loadConfig({ JWT_SECRET: testSecret, ...env });
}
