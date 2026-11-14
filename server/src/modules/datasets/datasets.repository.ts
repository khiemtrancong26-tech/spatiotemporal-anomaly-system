import type { Db, ObjectId } from 'mongodb';
import { toObjectId, toPublicId, toUtcIso } from '../../shared/persistence/mapping.js';
import { keysetPredicate } from '../../shared/persistence/keyset.js';
import type { Dataset, DatasetRepository, ImportSummary } from './datasets.types.js';

export interface DatasetDocument {
  _id: ObjectId; name: string; sourceFilename: string; status: Dataset['status'];
  createdBy: ObjectId; createdAt: Date; importSummary?: ImportSummary;
}

export function toDatasetDto(document: DatasetDocument): Dataset {
  const summary = document.importSummary;
  return {
    id: toPublicId(document._id), name: document.name, sourceFilename: document.sourceFilename,
    status: document.status, createdBy: toPublicId(document.createdBy), createdAt: toUtcIso(document.createdAt),
    ...(summary ? { importSummary: {
      totalRows: summary.totalRows, importedRows: summary.importedRows, duplicateRows: summary.duplicateRows,
      conflictingRows: summary.conflictingRows, invalidRows: summary.invalidRows,
      issues: summary.issues.map((issue) => ({ rowNumber: issue.rowNumber, reason: issue.reason,
        ...(issue.field !== undefined ? { field: issue.field } : {}),
        ...(issue.keptRowNumber !== undefined ? { keptRowNumber: issue.keptRowNumber } : {}),
      })),
    } } : {}),
  };
}

export function createDatasetRepository(db: Db): DatasetRepository {
  const collection = db.collection<DatasetDocument>('datasets');
  return {
    async listImported({ direction, limit, after }) {
      const boundary = after ? keysetPredicate('createdAt', direction, { key: new Date(after.key), id: toObjectId(after.id) }) : {};
      const documents = await collection.find({ status: 'imported', ...boundary }, { projection: {
        _id: 1, name: 1, sourceFilename: 1, status: 1, createdBy: 1, createdAt: 1, importSummary: 1,
      } }).sort({ createdAt: direction === 'asc' ? 1 : -1, _id: direction === 'asc' ? 1 : -1 }).limit(limit).toArray();
      return documents.map(toDatasetDto);
    },
  };
}
