import { Double, ObjectId, type ClientSession, type Db } from 'mongodb';
import type { ImportConfig } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import type { StoredResponse } from '../../shared/idempotency.js';
import { OwnershipLostError, type ReceiptGuard, type ReceiptRepository } from '../../shared/persistence/idempotency.js';
import { ensureOnlineIndexes } from '../../shared/persistence/indexes.js';
import { toDatasetDto, type DatasetDocument } from './datasets.repository.js';
import type { Dataset, ImportSummary, MappingRequest, ValidationReport } from './datasets.types.js';
import type { BatchResult, ImportDatasetState, NormalizedRow, ScanResult, SensorInput, SourceDescriptor } from './import.types.js';

type Report = Omit<ValidationReport, 'datasetId' | 'status'>;
interface ImportDocument extends DatasetDocument {
  source?: SourceDescriptor; validationReport?: Report; fieldMapping?: MappingRequest['fieldMap']; sourceUnit?: 'ug/m3';
  mappingConfirmed?: boolean; mappingVersion?: number; mappingError?: { code: string; message: string };
  importAttemptId?: string; importReceiptId?: string; batchRevision?: number;
}

export function createImportRepository(db: Db, receipts: ReceiptRepository, limits: ImportConfig) {
  const datasets = db.collection<ImportDocument>('datasets');
  let preparation: Promise<void> | undefined;
  function state(document: ImportDocument): ImportDatasetState {
    return { data: toDatasetDto(document), mappingVersion: document.mappingVersion ?? 0, mappingConfirmed: document.mappingConfirmed ?? false,
      ...(document.source ? { source: document.source } : {}), ...(document.validationReport ? { report: document.validationReport } : {}),
      ...(document.fieldMapping && document.sourceUnit ? { mapping: { fieldMap: document.fieldMapping, unit: document.sourceUnit } } : {}),
      ...(document.mappingError ? { mappingError: document.mappingError } : {}),
      ...(document.importAttemptId && document.importReceiptId ? { attempt: { receiptId: document.importReceiptId, owner: document.importAttemptId } } : {}),
    };
  }
  async function fence(guard: ReceiptGuard, session: ClientSession) {
    const result = await datasets.updateOne({ _id: new ObjectId(guard.resourceId), status: 'importing',
      importAttemptId: guard.owner, importReceiptId: guard.id }, { $inc: { batchRevision: 1 } }, { session });
    if (!result.matchedCount) throw new OwnershipLostError();
  }
  return {
    newId: () => new ObjectId().toHexString(),
    async prepare() {
      await receipts.prepare();
      preparation ??= ensureOnlineIndexes(db);
      try { await preparation; } catch (error) { preparation = undefined; throw error; }
    },
    async get(id: string): Promise<ImportDatasetState | null> {
      if (!/^[0-9a-f]{24}$/i.test(id)) return null;
      const document = await datasets.findOne({ _id: new ObjectId(id) });
      return document ? state(document) : null;
    },
    async sourceMissing(id: string) {
      await datasets.updateOne({ _id: new ObjectId(id), status: { $in: ['uploaded', 'awaiting_mapping', 'failed'] } },
        { $set: { status: 'failed', mappingConfirmed: false }, $unset: { mappingError: '' } });
    },
    async createUpload(guard: ReceiptGuard, data: Dataset, source: SourceDescriptor, report: Report): Promise<StoredResponse> {
      const response = { statusCode: 201, body: { data } };
      await receipts.transaction(guard, async session => {
        await datasets.insertOne({ _id: new ObjectId(data.id), name: data.name, sourceFilename: data.sourceFilename,
          status: data.status, createdBy: new ObjectId(data.createdBy), createdAt: new Date(data.createdAt),
          source, validationReport: report, mappingVersion: 0, mappingConfirmed: false,
        }, { session });
        await receipts.complete(guard, response, session);
      });
      return response;
    },
    async saveMapping(previous: ImportDatasetState, mapping: MappingRequest, scan: ScanResult): Promise<ImportDatasetState | null> {
      const update = await datasets.findOneAndUpdate({ _id: new ObjectId(previous.data.id), status: { $in: ['uploaded', 'awaiting_mapping', 'failed'] },
        mappingVersion: previous.mappingVersion,
      }, { $set: {
        fieldMapping: mapping.fieldMap, sourceUnit: mapping.unit, mappingConfirmed: !scan.fatal,
        mappingVersion: previous.mappingVersion + 1, validationReport: scan.report,
        status: scan.fatal ? 'failed' : 'awaiting_mapping', ...(scan.fatal ? { mappingError: scan.fatal } : {}),
      }, ...(!scan.fatal ? { $unset: { mappingError: '' } } : {}) }, { returnDocument: 'after' });
      return update ? state(update) : null;
    },
    async start(guard: ReceiptGuard, previous: ImportDatasetState) {
      await receipts.transaction(guard, async session => {
        const result = await datasets.updateOne({ _id: new ObjectId(previous.data.id), status: 'awaiting_mapping',
          mappingVersion: previous.mappingVersion, mappingConfirmed: true },
        { $set: { status: 'importing', importAttemptId: guard.owner, importReceiptId: guard.id }, $unset: { importSummary: '' } }, { session });
        if (!result.matchedCount) throw new HttpError(409, 'DATASET_STATE_CONFLICT', 'Dataset state or mapping changed before import.');
      });
    },
    async batch(guard: ReceiptGuard, rows: NormalizedRow[], sensors: SensorInput[]): Promise<BatchResult> {
      return receipts.transaction(guard, async session => {
        await fence(guard, session);
        const datasetId = new ObjectId(guard.resourceId);
        const stationIds = new Map(sensors.map(sensor => [sensor.externalId, sensor.id]));
        if (sensors.length) await db.collection('sensors').bulkWrite(sensors.map(sensor => ({ updateOne: {
          filter: { datasetId, externalId: sensor.externalId }, update: { $setOnInsert: {
            _id: new ObjectId(sensor.id), datasetId, externalId: sensor.externalId, name: sensor.name,
            ...(sensor.region ? { region: sensor.region } : {}), location: { type: 'Point', coordinates: [sensor.longitude, sensor.latitude] },
            type: 'pm25', unit: 'ug/m3', importAttemptId: guard.owner,
          } }, upsert: true,
        } })), { ordered: true, session });
        const keys = rows.map(row => ({ sensorId: new ObjectId(stationIds.get(row.externalId)!), ts: new Date(row.ts) }));
        const existing = rows.length ? await db.collection('readings').find({ datasetId, $or: keys },
          { session, projection: { sensorId: 1, ts: 1, value: 1, sourceRowNumber: 1 } }).toArray() : [];
        const seen = new Map(existing.map(row => [`${row.sensorId.toHexString()}|${row.ts.toISOString()}`, { value: row.value as number, row: row.sourceRowNumber as number }]));
        const inserts = [];
        const result: BatchResult = { importedRows: 0, duplicateRows: 0, conflictingRows: 0, issues: [] };
        for (const row of rows) {
          const sensorId = stationIds.get(row.externalId)!;
          const key = `${sensorId}|${row.ts}`;
          const kept = seen.get(key);
          if (kept) {
            const duplicate = kept.value === row.value;
            if (duplicate) result.duplicateRows++; else result.conflictingRows++;
            result.issues.push({ rowNumber: row.rowNumber, reason: duplicate ? 'DUPLICATE_SAME_VALUE' : 'DUPLICATE_VALUE_CONFLICT', keptRowNumber: kept.row });
            continue;
          }
          seen.set(key, { value: row.value, row: row.rowNumber });
          result.importedRows++;
          inserts.push({ insertOne: { document: { _id: new ObjectId(), datasetId, sensorId: new ObjectId(sensorId), ts: new Date(row.ts),
            location: { type: 'Point', coordinates: [row.longitude, row.latitude] }, value: new Double(row.value), unit: 'ug/m3',
            sourceRowNumber: row.rowNumber, importAttemptId: guard.owner,
          } } });
        }
        if (inserts.length) await db.collection('readings').bulkWrite(inserts, { ordered: true, session });
        return result;
      });
    },
    async publish(guard: ReceiptGuard, summary: ImportSummary, report: Report): Promise<StoredResponse> {
      return receipts.transaction(guard, async session => {
        await fence(guard, session);
        const document = await datasets.findOneAndUpdate({ _id: new ObjectId(guard.resourceId) },
          { $set: { status: 'imported', importSummary: summary, validationReport: report },
            $unset: { importAttemptId: '', importReceiptId: '', mappingError: '' } }, { session, returnDocument: 'after' });
        if (!document) throw new OwnershipLostError();
        const response = { statusCode: 200, body: { data: toDatasetDto(document) } };
        await receipts.complete(guard, response, session);
        return response;
      });
    },
    async fenceForRecovery(guard: ReceiptGuard): Promise<boolean> {
      return receipts.transaction(guard, async session => {
        const document = await datasets.findOne({ _id: new ObjectId(guard.resourceId) }, { session });
        if (!document) return false;
        // A receipt may expire BEFORE its start CAS. Never clean another receipt's
        // live attempt, or a dataset published by a different request.
        if (document.status !== 'importing' || document.importReceiptId !== guard.id) return false;
        await datasets.updateOne({ _id: document._id }, { $set: { status: 'importing', importAttemptId: guard.owner, importReceiptId: guard.id } }, { session });
        return true;
      });
    },
    async cleanup(guard: ReceiptGuard, signal?: AbortSignal) {
      for (const name of ['readings', 'sensors']) {
        let deleted: number;
        do {
          signal?.throwIfAborted();
          deleted = await receipts.transaction(guard, async session => {
            await fence(guard, session);
            const collection = db.collection(name);
            const ids = await collection.find({ datasetId: new ObjectId(guard.resourceId) }, { session, projection: { _id: 1 } }).limit(limits.batchSize).toArray();
            if (ids.length) await collection.bulkWrite(ids.map(row => ({ deleteOne: { filter: { _id: row._id } } })), { ordered: true, session });
            return ids.length;
          });
        } while (deleted);
      }
    },
    async fail(guard: ReceiptGuard, response: StoredResponse, report?: Report) {
      await receipts.transaction(guard, async session => {
        await fence(guard, session);
        await datasets.updateOne({ _id: new ObjectId(guard.resourceId) }, { $set: { status: 'failed', mappingConfirmed: false,
          ...(report ? { validationReport: report } : {}),
        }, $unset: { importAttemptId: '', importReceiptId: '', importSummary: '' } }, { session });
        await receipts.complete(guard, response, session);
      });
    },
  };
}
export type ImportRepository = ReturnType<typeof createImportRepository>;
