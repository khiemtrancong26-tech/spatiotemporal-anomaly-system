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
export interface DatasetRepository {
  listImported: (input: { direction: 'asc' | 'desc'; limit: number; after?: { key: string; id: string } }) => Promise<Dataset[]>;
}
