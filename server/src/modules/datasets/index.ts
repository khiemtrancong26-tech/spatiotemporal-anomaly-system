import type { FastifyPluginAsync } from 'fastify';
import { createCursorCodec } from '../../shared/pagination.js';
import { createDatasetRepository, createDatasetReadRepository } from './datasets.repository.js';
import type { Db } from 'mongodb';
import { createDatasetService } from './datasets.service.js';
import { createDatasetRoutes } from './datasets.routes.js';
import multipart from '@fastify/multipart';
import type { ImportConfig } from '../../config.js';
import { createReceiptRepository } from '../../shared/persistence/idempotency.js';
import { createImportRepository } from './import.repository.js';
import { createSourceFiles } from './source-files.js';
import { createImportService } from './import.service.js';
import { createImportRoutes } from './import.routes.js';
import type { ImportTestHooks } from './import.types.js';
import { errorDiagnostics } from '../../shared/error-diagnostics.js';

export type { DatasetReadAccess } from './datasets.types.js';
export const createDatasetReadAccess = (db: Db) => createDatasetReadRepository(db);

export const datasetRoutes: FastifyPluginAsync<{ cursorSecret: string; imports: ImportConfig; importTestHooks?: ImportTestHooks }> = async (app, options) => {
  const { cursorSecret, imports } = options;
  await app.register(multipart, { limits: { files: 1, fields: 1, parts: 2,
    fileSize: imports.maxFileBytes, fieldSize: imports.maxRecordBytes } });
  const service = createDatasetService(createDatasetRepository(app.mongo.db), createCursorCodec(cursorSecret));
  await app.register(createDatasetRoutes(service));
  const receipts = createReceiptRepository(app.mongo.client, app.mongo.db, imports);
  const importer = createImportService(createImportRepository(app.mongo.db, receipts, imports), receipts,
    createSourceFiles(imports.storageDir), imports, createDatasetReadRepository(app.mongo.db),
    (stage, error) => app.log.error({ event: 'import_failure', stage, ...errorDiagnostics(error) }, 'Import operation failed'),
    options.importTestHooks);
  await app.register(createImportRoutes(importer, imports.timeoutMs));
  let sweep: Promise<void> | undefined;
  const recover = () => {
    if (sweep) return;
    sweep = importer.recover().catch((error: unknown) => app.log.warn({ event: 'import_recovery_pending', ...errorDiagnostics(error) }, 'Import recovery will retry'))
      .finally(() => { sweep = undefined; });
  };
  let timer: ReturnType<typeof setInterval>;
  app.addHook('onReady', async () => { timer = setInterval(recover, Math.max(100, imports.leaseMs)); timer.unref(); });
  app.addHook('onClose', async () => { clearInterval(timer); await importer.close(); await sweep; });
};
