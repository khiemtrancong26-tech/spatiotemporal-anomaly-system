import type { FastifyPluginAsync } from 'fastify';
import { createCursorCodec } from '../../shared/pagination.js';
import { createDatasetRepository } from './datasets.repository.js';
import { createDatasetService } from './datasets.service.js';
import { createDatasetRoutes } from './datasets.routes.js';

export const datasetRoutes: FastifyPluginAsync<{ cursorSecret: string }> = async (app, { cursorSecret }) => {
  const service = createDatasetService(createDatasetRepository(app.mongo.db), createCursorCodec(cursorSecret));
  await app.register(createDatasetRoutes(service));
};
