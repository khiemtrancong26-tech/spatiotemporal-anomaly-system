import type { FastifyPluginAsync } from 'fastify';
import type { ExplorationConfig } from './exploration.types.js';
import { createExplorationRepository } from './exploration.repository.js';
import { createExplorationService } from './exploration.service.js';
import { createExplorationRoutes } from './exploration.routes.js';
export const explorationRoutes: FastifyPluginAsync<{ config: ExplorationConfig }> = async (app, { config }) => {
  const service = createExplorationService(createExplorationRepository(app.mongo.db, config.maxReadings), config);
  await app.register(createExplorationRoutes(service));
};
