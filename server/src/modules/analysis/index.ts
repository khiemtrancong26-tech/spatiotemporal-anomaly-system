import type { FastifyPluginAsync } from 'fastify';
import type { AnalysisConfig } from '../../config.js';
import { createOnlineEngine } from '../../engines/online.js';
import { createCursorCodec } from '../../shared/pagination.js';
import { createDatasetReadAccess } from '../datasets/index.js';
import { createAnalysisRepository } from './analysis.repository.js';
import { createAnalysisRoutes } from './analysis.routes.js';
import { createAnalysisService } from './analysis.service.js';
import { createAnalysisWorker } from './analysis.worker.js';
import type { AnalysisEngine, AnalysisTestHooks } from './analysis.types.js';

export const analysisRoutes: FastifyPluginAsync<{ config: AnalysisConfig; cursorSecret: string;
  testHooks?: AnalysisTestHooks; testEngine?: AnalysisEngine; workerEnabled?: boolean }> = async (app, options) => {
  const repository = createAnalysisRepository(app.mongo.client, app.mongo.db, options.config);
  const engine = options.testEngine ?? createOnlineEngine(options.config);
  const service = createAnalysisService(repository, createDatasetReadAccess(app.mongo.db), createCursorCodec(options.cursorSecret), options.config, engine, options.testHooks);
  await app.register(createAnalysisRoutes(service));
  const worker = createAnalysisWorker(repository, engine, options.config,
    () => app.log.warn({ event: 'analysis_recovery_pending' }, 'Analysis worker will retry MongoDB recovery'), options.testHooks);
  app.addHook('onReady', async () => { if (options.workerEnabled !== false) worker.start(); });
  app.addHook('onClose', async () => { await worker.close(); });
};
