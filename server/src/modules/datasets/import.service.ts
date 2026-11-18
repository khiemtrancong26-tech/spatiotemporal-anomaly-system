import type { DatasetActor } from './dataset-access.js';
import type { DatasetReadAccess } from './datasets.types.js';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ImportConfig } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import { requireIdempotencyKey, type StoredResponse } from '../../shared/idempotency.js';
import { createCapacity } from '../../shared/import-capacity.js';
import { interruptedResponse, OwnershipLostError, type ReceiptGuard, type ReceiptRepository } from '../../shared/persistence/idempotency.js';
import type { ImportRepository } from './import.repository.js';
import type { ImportDatasetState, ImportTestHooks, NormalizedRow, SensorInput, SourceDescriptor, SourceFormat } from './import.types.js';
import { requiredSourceFields, type Dataset, type ImportSummary, type MappingRequest, type ValidationReport } from './datasets.types.js';
import type { SourceFiles } from './source-files.js';
import { readSourceRows } from './source-parser.js';
import { normalizeRow } from './normalization.js';
import { scanSource } from './source-scan.js';

export type UploadPart = { type: 'file'; fieldname: string; filename: string; mimetype: string; stream: Readable; truncated: () => boolean }
  | { type: 'field'; fieldname: string; value: unknown };
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sameMapping(a: MappingRequest | undefined, b: MappingRequest) {
  return a?.unit === b.unit && JSON.stringify(Object.entries(a.fieldMap).sort()) === JSON.stringify(Object.entries(b.fieldMap).sort());
}
function failure(error: unknown): StoredResponse {
  if (error instanceof HttpError) return { statusCode: error.statusCode, body: {
    error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
  } };
  return interruptedResponse;
}

export function createImportService(repository: ImportRepository, receipts: ReceiptRepository, files: SourceFiles,
  limits: ImportConfig, access: DatasetReadAccess, reportFailure: (stage: string, error: unknown) => void,
  hooks: ImportTestHooks = {}, now: () => Date = () => new Date()) {
  const uploads = createCapacity(limits.uploadConcurrency);
  const imports = createCapacity(limits.importConcurrency, limits.importMaxWaiting);
  // Reserve queue room for uploads and imports that already hold admission.
  const scans = createCapacity(limits.scanConcurrency, limits.scanMaxWaiting + limits.uploadConcurrency + limits.importConcurrency);
  const mappings = createCapacity(limits.scanConcurrency + limits.scanMaxWaiting);
  const active = new Set<AbortController>();
  let recovery: Promise<void> | undefined;
  function lifetime() {
    const controller = new AbortController(); active.add(controller);
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs); timer.unref();
    return { signal: controller.signal, controller, stop() { clearTimeout(timer); active.delete(controller); } };
  }
  async function scan(source: SourceDescriptor, signal: AbortSignal, mapping?: MappingRequest, disconnected?: AbortSignal) {
    const release = await scans.acquireOrWait(disconnected ? AbortSignal.any([signal, disconnected]) : signal);
    if (!release) throw new HttpError(500, 'SOURCE_UNAVAILABLE', 'Source validation capacity is busy.');
    try {
      disconnected?.throwIfAborted();
      signal.throwIfAborted();
      return await scanSource(files, source, limits, signal, mapping);
    } finally { release(); }
  }
  async function owned<T>(guard: ReceiptGuard, controller: AbortController, work: () => Promise<T>): Promise<T> {
    let pending: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (pending) return;
      pending = receipts.renew(guard).then(ok => { if (!ok) controller.abort(); }, (error: unknown) => {
        reportFailure('lease_renewal', error);
        controller.abort();
      }).finally(() => { pending = undefined; });
    }, Math.max(10, Math.floor(limits.leaseMs / 3)));
    timer.unref();
    try { controller.signal.throwIfAborted(); return await work(); }
    finally { clearInterval(timer); await pending; }
  }
  async function authorize(id: string, actor: DatasetActor) {
    if (!await access.getState(id, actor)) throw new HttpError(404, 'DATASET_NOT_FOUND', 'Dataset does not exist.');
  }
  async function load(id: string, actor: DatasetActor): Promise<ImportDatasetState> {
    const dataset = await repository.get(id, actor);
    if (!dataset) throw new HttpError(404, 'DATASET_NOT_FOUND', 'Dataset does not exist.');
    return dataset;
  }
  async function recoverOne(guard: ReceiptGuard) {
    const job = lifetime();
    try {
      await owned(guard, job.controller, async () => {
        if (guard.kind === 'upload') {
          const dataset = await repository.get(guard.resourceId);
          if (!dataset) await files.remove(`${guard.resourceId}.source`);
          await receipts.finish(guard, interruptedResponse);
        } else if (await repository.fenceForRecovery(guard)) {
          await repository.cleanup(guard, job.signal);
          job.signal.throwIfAborted();
          await repository.fail(guard, interruptedResponse);
        } else if (!await receipts.snapshot(guard)) await receipts.finish(guard, interruptedResponse);
      });
    } finally { job.stop(); }
  }
  async function recover(filter: { resourceId?: string; userId?: string; key?: string } = {}) {
    // One bounded recovery sweep per app; ownership is still claimed atomically in MongoDB.
    if (recovery) { await recovery; return; }
    recovery = (async () => {
      for (let count = 0; count < limits.recoveryBatchSize; count++) {
        const guard = await receipts.takeExpired(filter);
        if (!guard) break;
        await recoverOne(guard);
      }
    })();
    try { await recovery; } finally { recovery = undefined; }
  }
  function recoverSnapshot(guard: ReceiptGuard) {
    return receipts.snapshot(guard).catch((error: unknown) => { reportFailure('receipt_snapshot', error); return null; });
  }
  async function snapshotOrFailure(guard: ReceiptGuard, error: unknown, started: boolean, controller: AbortController): Promise<StoredResponse> {
    const saved = await recoverSnapshot(guard);
    if (saved) return saved; // A response can be lost AFTER its transaction committed.
    if (error instanceof OwnershipLostError) throw error;
    const response = failure(error);
    if (response.statusCode >= 500) reportFailure('operation_failed', error);
    try {
      if (!started && guard.kind === 'import') {
        // Reconcile an ambiguous start commit before finalising its receipt. A DB
        // outage leaves processing private for recovery rather than stranding it.
        const dataset = await repository.get(guard.resourceId);
        started = dataset?.data.status === 'importing' && dataset.attempt?.receiptId === guard.id && dataset.attempt.owner === guard.owner;
      }
      await owned(guard, controller, async () => {
        if (started) {
          await repository.cleanup(guard, controller.signal);
          controller.signal.throwIfAborted();
          await repository.fail(guard, response);
        } else await receipts.finish(guard, response);
      });
      return response;
    } catch (error) {
      reportFailure('failure_reconciliation', error);
      const committed = await recoverSnapshot(guard);
      if (committed) return committed;
      // A failed cleanup/commit leaves processing + private partial data for lease recovery.
      return interruptedResponse;
    }
  }
  return {
    recover,
    async upload(userId: string, keyValue: unknown, parts: AsyncIterable<UploadPart>): Promise<StoredResponse> {
      const key = requireIdempotencyKey(keyValue);
      const release = uploads.acquire();
      if (!release) throw new HttpError(503, 'UPLOAD_CAPACITY', 'Upload capacity is busy. Try again later with the same key.');
      const job = lifetime();
      let temporary: string | undefined, persisted: string | undefined, guard: ReceiptGuard | undefined;
      try {
        let file: { filename: string; mimetype: string; bytes: number; checksum: string } | undefined;
        let name: string | undefined;
        let invalidFields = false;
        for await (const part of parts) {
          job.signal.throwIfAborted();
          if (part.type === 'file') {
            if (file || part.fieldname !== 'file') invalidFields = true;
            const spooled = await files.spool(part.stream, limits.maxFileBytes, job.signal);
            if (temporary) await files.remove(temporary);
            temporary = spooled.fileId;
            if (part.truncated()) throw new HttpError(413, 'FILE_TOO_LARGE', 'Source file exceeds the configured byte limit.');
            file = { filename: part.filename.replace(/\\/g, '/').split('/').at(-1) ?? '', mimetype: part.mimetype.toLowerCase(), bytes: spooled.bytes, checksum: spooled.checksum };
          } else if (part.fieldname !== 'name' || typeof part.value !== 'string' || name !== undefined) invalidFields = true;
          else name = part.value;
        }
        if (!file || !temporary || invalidFields) throw new HttpError(422, 'INVALID_UPLOAD_FIELDS', 'Upload must contain exactly one file and optionally one name field.');
        await repository.prepare(); await recover({ userId, key });
        const resourceId = repository.newId();
        const claimed = await receipts.claim({ userId, key, kind: 'upload', operation: 'POST /api/v1/datasets', resourceId,
          requestHash: hash({ operation: 'POST /api/v1/datasets', checksum: file.checksum, filename: file.filename, mimetype: file.mimetype, name: name ?? null }),
        });
        if ('replay' in claimed) return claimed.replay;
        guard = claimed.guard;
        const ownership = guard;
        return await owned(ownership, job.controller, async () => {
          const extension = /\.([^.]+)$/.exec(file.filename)?.[1]?.toLowerCase();
          const format: SourceFormat | undefined = extension === 'csv' || extension === 'json' ? extension : undefined;
          const allowed = format === 'csv' ? ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream', 'text/plain']
            : ['application/json', 'text/json', 'application/octet-stream', 'text/plain'];
          if (!format || !allowed.includes(file.mimetype)) throw new HttpError(415, 'UNSUPPORTED_SOURCE_TYPE', 'Only CSV and JSON sources with supported media types are accepted.');
          persisted = await files.persist(temporary!, ownership.resourceId); temporary = undefined;
          const source: SourceDescriptor = { fileId: persisted, format, checksum: file.checksum, bytes: file.bytes };
          await hooks.afterSourcePersist?.();
          const result = await scan(source, job.signal);
          if (!result.report.totalRows || !result.report.sourceColumns.length) throw new HttpError(422, 'EMPTY_SOURCE', 'Source must contain records with mappable columns.');
          if (result.fatal) throw new HttpError(422, result.fatal.code, result.fatal.message, { issueLimit: limits.maxIssues });
          job.signal.throwIfAborted();
          const data: Dataset = { id: ownership.resourceId, name: name?.trim() || file.filename, sourceFilename: file.filename,
            status: 'awaiting_mapping', createdBy: userId, createdAt: now().toISOString() };
          return repository.createUpload(ownership, data, source, result.report);
        });
      } catch (error) {
        if (guard) {
          const saved = await recoverSnapshot(guard);
          if (saved) return saved;
          if (persisted) {
            try { if (!await repository.get(guard.resourceId)) await files.remove(persisted); }
            catch (cleanupError) {
              reportFailure('upload_source_reconciliation', cleanupError);
              return interruptedResponse; // A DB outage may leave the upload outcome unconfirmed.
            }
          }
          return await snapshotOrFailure(guard, error, false, job.controller);
        }
        if (error instanceof HttpError) throw error;
        if ((error as { statusCode?: number }).statusCode === 413) throw new HttpError(413, 'FILE_TOO_LARGE', 'Multipart upload exceeds configured limits.');
        if ((error as { code?: string }).code?.startsWith('FST_')) throw new HttpError(400, 'INVALID_MULTIPART', 'Multipart body is invalid.');
        reportFailure('upload_unavailable', error);
        throw new HttpError(503, 'SOURCE_STORAGE_UNAVAILABLE', 'Source upload could not complete. Check connectivity and persistent storage.');
      } finally {
        if (temporary) await files.remove(temporary).catch((error: unknown) => reportFailure('temporary_source_cleanup', error));
        job.stop(); release();
      }
    },
    async validation(id: string, actor: DatasetActor): Promise<ValidationReport> {
      await authorize(id, actor);
      await recover({ resourceId: id });
      let dataset = await load(id, actor);
      if (!dataset.report) throw new HttpError(404, 'VALIDATION_NOT_FOUND', 'No source validation report exists for this dataset.');
      if (dataset.source && dataset.data.status !== 'imported' && !await files.exists(dataset.source.fileId)) {
        await repository.sourceMissing(id, actor); dataset = await load(id, actor);
      }
      return { ...dataset.report!, datasetId: id, status: dataset.data.status };
    },
    async mapping(id: string, mapping: MappingRequest, actor: DatasetActor, disconnected?: AbortSignal): Promise<Dataset> {
      const job = lifetime();
      let release: (() => void) | null = null;
      try {
        await authorize(id, actor);
        await repository.prepare(); await recover({ resourceId: id });
        const dataset = await load(id, actor);
        if (!['uploaded', 'awaiting_mapping', 'failed'].includes(dataset.data.status)) throw new HttpError(409, 'DATASET_STATE_CONFLICT', 'Mapping cannot change while importing or after import.');
        if (!dataset.source || !dataset.report || !await files.exists(dataset.source.fileId)) {
          await repository.sourceMissing(id, actor); throw new HttpError(500, 'SOURCE_UNAVAILABLE', 'Persistent source is unavailable; start a new upload intentionally.');
        }
        for (const field of requiredSourceFields) if (!mapping.fieldMap[field]) throw new HttpError(422, 'INVALID_MAPPING', 'All required source fields must be mapped.');
        for (const column of Object.values(mapping.fieldMap)) if (!dataset.report.sourceColumns.includes(column)) throw new HttpError(422, 'INVALID_MAPPING', 'Mapped column does not exist in the source.');
        if (sameMapping(dataset.mapping, mapping)) {
          if (dataset.mappingError) throw new HttpError(422, dataset.mappingError.code, dataset.mappingError.message);
          if (dataset.mappingConfirmed) return dataset.data;
        }
        release = mappings.acquire();
        if (!release) throw new HttpError(500, 'SOURCE_UNAVAILABLE', 'Mapping validation capacity is busy.');
        const result = await scan(dataset.source, job.signal, mapping, disconnected);
        job.signal.throwIfAborted();
        const updated = await repository.saveMapping(dataset, mapping, result, actor);
        if (!updated) {
          const latest = await load(id, actor);
          if (latest.mappingConfirmed && sameMapping(latest.mapping, mapping)) return latest.data;
          throw new HttpError(409, 'DATASET_STATE_CONFLICT', 'Dataset state or mapping changed. Reload validation before continuing.');
        }
        if (result.fatal) throw new HttpError(422, result.fatal.code, result.fatal.message, { issueLimit: limits.maxIssues });
        return updated.data;
      } catch (error) {
        if (error instanceof HttpError && error.statusCode < 500) throw error;
        if (error instanceof HttpError && error.code === 'SOURCE_CHANGED') {
          await repository.sourceMissing(id, actor).catch((cause: unknown) => reportFailure('mark_missing_source', cause));
        }
        reportFailure('mapping_unavailable', error);
        throw new HttpError(500, 'SOURCE_UNAVAILABLE', 'Mapping validation could not complete. Check persistent source and database.');
      } finally { job.stop(); release?.(); }
    },
    async import(actor: DatasetActor, id: string, keyValue: unknown, disconnected?: AbortSignal): Promise<StoredResponse> {
      const userId = actor.id;
      await authorize(id, actor);
      const key = requireIdempotencyKey(keyValue);
      const job = lifetime();
      let guard: ReceiptGuard | undefined, release: (() => void) | undefined;
      let started = false;
      try {
        await repository.prepare(); await recover({ userId, key }); await recover({ resourceId: id });
        job.signal.throwIfAborted();
        let dataset = await load(id, actor);
        const intent = { userId, key, kind: 'import' as const, operation: `POST /api/v1/datasets/${id}/imports`,
          resourceId: dataset.data.id, requestHash: hash({ operation: 'import', path: `/api/v1/datasets/${id}/imports` }) };
        const existing = await receipts.inspect(intent);
        if (existing) return existing.replay;
        if (dataset.data.status === 'importing') throw new HttpError(409, 'DATASET_STATE_CONFLICT', 'Dataset is importing or recovering.');
        if (dataset.data.status !== 'imported') {
          if (!dataset.mappingConfirmed || !dataset.mapping || !dataset.source) throw new HttpError(422, 'MAPPING_REQUIRED', 'Confirm a valid mapping before import or retry.');
          release = imports.acquire() ?? undefined;
          if (!release) {
            const wait = AbortSignal.any([job.signal, AbortSignal.timeout(limits.importWaitMs), ...(disconnected ? [disconnected] : [])]);
            release = await imports.acquireOrWait(wait) ?? undefined;
            if (!release || wait.aborted) throw new HttpError(503, 'IMPORT_CAPACITY', 'Import capacity is busy. Retry later with the same key.');
            dataset = await load(id, actor);
            disconnected?.throwIfAborted();
          }
        }
        job.signal.throwIfAborted();
        const claimed = await receipts.claim(intent);
        if ('replay' in claimed) return claimed.replay;
        guard = claimed.guard;
        const ownership = guard;
        return await owned(ownership, job.controller, async () => {
          if (dataset.data.status === 'imported') {
            const response = { statusCode: 200, body: { data: dataset.data } }; await receipts.finish(ownership, response); return response;
          }
          if (dataset.data.status === 'importing') throw new HttpError(409, 'DATASET_STATE_CONFLICT', 'Dataset is importing or recovering.');
          if (!dataset.mappingConfirmed || !dataset.mapping || !dataset.source) throw new HttpError(422, 'MAPPING_REQUIRED', 'Confirm a valid mapping before import or retry.');
          await repository.start(ownership, dataset, actor); started = true;
          const result = await scan(dataset.source, job.signal, dataset.mapping);
          if (result.fatal) throw new HttpError(422, result.fatal.code, result.fatal.message);
          const summary: ImportSummary = { totalRows: result.report.totalRows, importedRows: 0, duplicateRows: 0, conflictingRows: 0,
            invalidRows: result.report.invalidRows, issues: [...result.report.issues] };
          const stations = new Map<string, SensorInput>();
          let batch: NormalizedRow[] = [], batchBytes = 0, batches = 0;
          async function flush() {
            if (!batch.length) return;
            job.signal.throwIfAborted();
            const touched = [...new Set(batch.map(row => row.externalId))].map(externalId => stations.get(externalId)!);
            const result = await repository.batch(ownership, batch, touched);
            summary.importedRows += result.importedRows; summary.duplicateRows += result.duplicateRows; summary.conflictingRows += result.conflictingRows;
            if (summary.issues.length + result.issues.length > limits.maxIssues) throw new HttpError(422, 'REPORT_LIMIT_EXCEEDED', 'Import issue count exceeds the configured report limit; partial data will not be published.');
            summary.issues.push(...result.issues); batch = []; batchBytes = 0;
            await hooks.afterBatch?.(++batches);
          }
          const columns = new Set<string>();
          for await (const row of readSourceRows(files.verified(dataset.source.fileId, dataset.source.checksum, job.signal), dataset.source.format, limits.maxRecordBytes, columns)) {
            const normalized = normalizeRow(row, dataset.mapping);
            if ('issue' in normalized) continue;
            const point = normalized.value;
            if (!stations.has(point.externalId)) stations.set(point.externalId, { id: repository.newId(), externalId: point.externalId,
              name: point.name, longitude: point.longitude, latitude: point.latitude, ...(point.region ? { region: point.region } : {}) });
            const bytes = Buffer.byteLength(JSON.stringify(point));
            if (batch.length >= limits.batchSize || batchBytes + bytes > limits.batchBytes) await flush();
            batch.push(point); batchBytes += bytes;
          }
          await flush(); job.signal.throwIfAborted();
          summary.issues.sort((a, b) => a.rowNumber - b.rowNumber);
          const response = await repository.publish(ownership, summary, result.report);
          await hooks.afterPublish?.();
          return response;
        });
      } catch (error) {
        if (guard) return await snapshotOrFailure(guard, error, started, job.controller);
        if (error instanceof HttpError) throw error;
        reportFailure('import_unavailable', error);
        throw new HttpError(503, 'IMPORT_UNAVAILABLE', 'Import could not start. Check database availability.');
      }
      finally { job.stop(); release?.(); }
    },
    async close() {
      for (const controller of active) controller.abort();
      await recovery?.catch((error: unknown) => reportFailure('recovery_on_shutdown', error));
    },
  };
}
