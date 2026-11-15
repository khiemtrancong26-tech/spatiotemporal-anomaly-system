import type { ImportConfig } from '../../config.js';
import type { ImportIssue, MappingRequest } from './datasets.types.js';
import type { ScanResult, SourceDescriptor } from './import.types.js';
import { mappingSuggestions, normalizeRow } from './normalization.js';
import { readSourceRows } from './source-parser.js';
import type { SourceFiles } from './source-files.js';

export async function scanSource(files: SourceFiles, source: SourceDescriptor, limits: ImportConfig,
  signal: AbortSignal, mapping?: MappingRequest): Promise<ScanResult> {
  const columns = new Set<string>();
  const report: ScanResult['report'] = { sourceColumns: [], totalRows: 0, validRows: 0, invalidRows: 0, mappingSuggestions: {}, issues: [] };
  const sensors = new Map<string, [number, number]>();
  let fatal: ScanResult['fatal'];
  for await (const row of readSourceRows(files.verified(source.fileId, source.checksum, signal), source.format, limits.maxRecordBytes, columns)) {
    report.totalRows++;
    let issues: ImportIssue[] = row.structuralValid ? [] : [{ rowNumber: row.rowNumber, reason: 'INVALID_ROW' }];
    if (mapping && !issues.length) {
      const normalized = normalizeRow(row, mapping);
      if ('issue' in normalized) issues = normalized.issues;
      else {
        const point = normalized.value;
        const location = sensors.get(point.externalId);
        if (location && (location[0] !== point.longitude || location[1] !== point.latitude)) {
          issues.push({ rowNumber: row.rowNumber, reason: 'INVALID_ROW', field: 'location' });
          fatal ??= { code: 'SENSOR_LOCATION_CONFLICT', message: 'A station has inconsistent coordinates in otherwise valid rows.' };
        } else if (!location && sensors.size >= limits.maxSensors) {
          issues.push({ rowNumber: row.rowNumber, reason: 'INVALID_ROW', field: 'sensorId' });
          fatal ??= { code: 'SENSOR_LIMIT_EXCEEDED', message: 'Dataset exceeds the configured station limit.' };
        } else if (!location) sensors.set(point.externalId, [point.longitude, point.latitude]);
      }
    }
    if (issues.length) {
      report.invalidRows++;
      for (const issue of issues) {
        if (report.issues.length < limits.maxIssues) report.issues.push(issue);
        else fatal ??= { code: 'REPORT_LIMIT_EXCEEDED', message: 'Issue count exceeds the configured report limit; dataset was not accepted for import.' };
      }
    } else report.validRows++;
  }
  report.sourceColumns = [...columns];
  report.mappingSuggestions = mappingSuggestions(columns);
  if (mapping && report.validRows === 0) fatal ??= { code: 'NO_VALID_ROWS', message: 'There are no valid rows to import.' };
  return { report, ...(fatal ? { fatal } : {}) };
}
