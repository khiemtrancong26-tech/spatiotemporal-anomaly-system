import type { FastifyPluginAsync } from 'fastify';
import type { AnalysisConfig } from '../../config.js';
import type { DatasetWriteScheduler } from '../datasets/dataset-write.js';
import { createOnlineEngine } from '../../engines/online.js';
import { createCursorCodec } from '../../shared/pagination.js';
import { createDatasetReadAccess } from '../datasets/index.js';
import { createAnalysisRepository } from './analysis.repository.js';
import { createAnalysisRoutes } from './analysis.routes.js';
import { createAnalysisService } from './analysis.service.js';
import { createAnalysisWorker } from './analysis.worker.js';
import type { AnalysisEngine, AnalysisTestHooks } from './analysis.types.js';
import type { Db } from 'mongodb';
import { createAnalysisReadRepository } from './analysis.repository.js';
import { errorDiagnostics } from '../../shared/error-diagnostics.js';

export type { AnalysisReadAccess } from './analysis.types.js';
export const createAnalysisReadAccess = (db: Db) => createAnalysisReadRepository(db);

export const analysisRoutes: FastifyPluginAsync<{ config: AnalysisConfig; cursorSecret: string; schedule: DatasetWriteScheduler;
  testHooks?: AnalysisTestHooks; testEngine?: AnalysisEngine; workerEnabled?: boolean }> = async (app, options) => {
  const repository = createAnalysisRepository(app.mongo.client, app.mongo.db, options.config, options.schedule);
  const engine = options.testEngine ?? createOnlineEngine(options.config);
  const service = createAnalysisService(repository, createDatasetReadAccess(app.mongo.db), createCursorCodec(options.cursorSecret), options.config, engine, options.testHooks);
  const worker = createAnalysisWorker(repository, engine, options.config,
    (stage, error) => app.log.error({ event: 'analysis_worker_failed', stage, ...errorDiagnostics(error) }, 'Analysis worker failed'),
    options.testHooks);
  await app.register(createAnalysisRoutes(service, worker.wake));
  app.addHook('onReady', async () => { if (options.workerEnabled !== false) worker.start(); });
  app.addHook('onClose', async () => { await worker.close(); });
};
