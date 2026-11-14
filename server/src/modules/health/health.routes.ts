import type { FastifyPluginAsync } from 'fastify';
import type { createHealthService } from './health.service.js';
import { healthResponseSchema } from './health.schema.js';
import { errorSchema } from '../../shared/http/errors.js';

export function createHealthRoutes(service: ReturnType<typeof createHealthService>): FastifyPluginAsync {
  return async (app) => {
    app.get('/health', {
      schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema, 500: errorSchema } },
    }, async (_request, reply) => {
      const result = await service.readiness();
      return reply.code(result.statusCode).send(result.body);
    });
  };
}
