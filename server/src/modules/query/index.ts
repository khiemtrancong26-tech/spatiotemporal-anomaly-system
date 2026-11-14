import type { FastifyPluginAsync } from 'fastify';
import { createDatasetReadAccess } from '../datasets/index.js';
import { createCursorCodec } from '../../shared/pagination.js';
import { createQueryRepository } from './query.repository.js';
import { createQueryService } from './query.service.js';
import { createQueryRoutes } from './query.routes.js';

export const queryRoutes: FastifyPluginAsync<{ cursorSecret: string }> = async (app, options) => {
  const service = createQueryService(createQueryRepository(app.mongo.db), createDatasetReadAccess(app.mongo.db), createCursorCodec(options.cursorSecret));
  await app.register(createQueryRoutes(service));
};
