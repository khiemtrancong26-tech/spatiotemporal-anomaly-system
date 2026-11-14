import type { HealthRepository } from './health.repository.js';

export interface HealthResponse { status: 'ok' | 'degraded'; timestamp: string }
export function createHealthService(repository: HealthRepository, now: () => Date = () => new Date()) {
  return {
    async readiness(): Promise<{ statusCode: 200 | 503; body: HealthResponse }> {
      let ready = false;
      try { ready = await repository.ping(); } catch { /* dependency failure is a readiness state */ }
      return { statusCode: ready ? 200 : 503, body: { status: ready ? 'ok' : 'degraded', timestamp: now().toISOString() } };
    },
  };
}
