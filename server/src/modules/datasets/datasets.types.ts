export interface ImportIssue {
  rowNumber: number;
  reason: 'DUPLICATE_SAME_VALUE' | 'DUPLICATE_VALUE_CONFLICT' | 'INVALID_ROW';
  field?: string;
  keptRowNumber?: number;
}
export interface ImportSummary {
  totalRows: number; importedRows: number; duplicateRows: number; conflictingRows: number; invalidRows: number;
  issues: ImportIssue[];
}
export interface Dataset {
  id: string; name: string; sourceFilename: string;
  status: 'uploaded' | 'awaiting_mapping' | 'importing' | 'imported' | 'failed';
  createdBy: string; createdAt: string; importSummary?: ImportSummary;
}
export interface DatasetListQuery { sort?: string; limit?: number; cursor?: string }
export const requiredSourceFields = ['sensorId', 'latitude', 'longitude', 'timestamp', 'value'] as const;
export type SourceField = typeof requiredSourceFields[number] | 'unit' | 'name' | 'region';
export interface MappingRequest {
  fieldMap: Record<typeof requiredSourceFields[number], string> & Partial<Record<'unit' | 'name' | 'region', string>>;
  unit: 'ug/m3';
}
export interface ValidationReport {
  datasetId: string; status: Dataset['status']; sourceColumns: string[];
  totalRows: number; validRows: number; invalidRows: number;
  mappingSuggestions: Record<string, string>; issues: ImportIssue[];
}
export interface DatasetRepository {
  listImported: (input: { direction: 'asc' | 'desc'; limit: number; after?: { key: string; id: string } }) => Promise<Dataset[]>;
}
