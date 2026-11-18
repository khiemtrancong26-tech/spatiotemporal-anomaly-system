import type { FastifyPluginAsync } from 'fastify';
import type { Db, MongoClient } from 'mongodb';
import type { ReviewConfig } from '../../config.js';
import type { DatasetWriteScheduler } from '../datasets/dataset-write.js';
import { createDatasetReadAccess } from '../datasets/index.js';
import { createAnalysisReadAccess } from '../analysis/index.js';
import { createCursorCodec } from '../../shared/pagination.js';
import { createAnomalyRepository } from './anomalies.repository.js';
import { createAnomalyService, createAnomalyReviewService } from './anomalies.service.js';
import { createAnomalyRoutes } from './anomalies.routes.js';

export const createAnomalyReviewAccess = (client: MongoClient, db: Db, config?: ReviewConfig, schedule?: DatasetWriteScheduler) =>
  createAnomalyReviewService(createAnomalyRepository(client, db, config, schedule));
export type { ReviewRequest } from './anomalies.types.js';
export { anomalySchema, reviewRequestSchema } from './anomalies.schema.js';
export const anomalyRoutes: FastifyPluginAsync<{ cursorSecret: string; review: ReviewConfig; schedule: DatasetWriteScheduler }> = async (app, options) => {
  const service = createAnomalyService(createAnomalyRepository(app.mongo.client, app.mongo.db, options.review, options.schedule), createDatasetReadAccess(app.mongo.db),
    createAnalysisReadAccess(app.mongo.db), createCursorCodec(options.cursorSecret));
  await app.register(createAnomalyRoutes(service));
};
