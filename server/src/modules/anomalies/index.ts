import type { FastifyPluginAsync } from 'fastify';
import type { Db, MongoClient } from 'mongodb';
import { createDatasetReadAccess } from '../datasets/index.js';
import { createAnalysisReadAccess } from '../analysis/index.js';
import { createCursorCodec } from '../../shared/pagination.js';
import { createAnomalyRepository } from './anomalies.repository.js';
import { createAnomalyService, createAnomalyReviewService } from './anomalies.service.js';
import { createAnomalyRoutes } from './anomalies.routes.js';

/** Reusable validation/CAS only; future Sync still needs auth + atomic mutation ledger. */
export const createAnomalyReviewAccess = (client: MongoClient, db: Db) => createAnomalyReviewService(createAnomalyRepository(client, db));
export type { ReviewRequest } from './anomalies.types.js';
export const anomalyRoutes: FastifyPluginAsync<{ cursorSecret: string }> = async (app, options) => {
  const service = createAnomalyService(createAnomalyRepository(app.mongo.client, app.mongo.db), createDatasetReadAccess(app.mongo.db),
    createAnalysisReadAccess(app.mongo.db), createCursorCodec(options.cursorSecret));
  await app.register(createAnomalyRoutes(service));
};
