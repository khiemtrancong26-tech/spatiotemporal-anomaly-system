import type { FastifyPluginAsync } from 'fastify';
import { createHealthRepository } from './health.repository.js';
import { createHealthService } from './health.service.js';
import { createHealthRoutes } from './health.routes.js';

// Feature composition is the only place that wires repositories to services/routes.
export const healthRoutes: FastifyPluginAsync = async (app) => {
  const service = createHealthService(createHealthRepository(app.mongo.client, app.mongo.db, app.mongo.timeoutMs));
  await app.register(createHealthRoutes(service));
};
