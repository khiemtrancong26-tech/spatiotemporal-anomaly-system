import type { Dataset, ImportIssue, MappingRequest, ValidationReport } from './datasets.types.js';

export type SourceFormat = 'csv' | 'json';
export interface SourceDescriptor { fileId: string; format: SourceFormat; checksum: string; bytes: number }
export interface SourceRow { rowNumber: number; values: Record<string, unknown>; structuralValid: boolean }
export interface NormalizedRow {
  rowNumber: number; externalId: string; name: string; region?: string;
  longitude: number; latitude: number; ts: string; value: number;
}
export interface SensorInput {
  id: string; externalId: string; name: string; region?: string; longitude: number; latitude: number;
}
export interface ImportDatasetState {
  data: Dataset; source?: SourceDescriptor; report?: Omit<ValidationReport, 'datasetId' | 'status'>;
  mapping?: MappingRequest; mappingVersion: number; mappingConfirmed: boolean;
  mappingError?: { code: string; message: string };
  attempt?: { receiptId: string; owner: string };
}
export interface ScanResult {
  report: Omit<ValidationReport, 'datasetId' | 'status'>;
  fatal?: { code: string; message: string };
}
export interface BatchResult { importedRows: number; duplicateRows: number; conflictingRows: number; issues: ImportIssue[] }
export interface ImportTestHooks {
  afterSourcePersist?: () => Promise<void>;
  afterBatch?: (committedBatches: number) => Promise<void>;
  afterPublish?: () => Promise<void>;
}
