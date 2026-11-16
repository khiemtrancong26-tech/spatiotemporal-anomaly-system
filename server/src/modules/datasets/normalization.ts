import type { ImportIssue, MappingRequest } from './datasets.types.js';
import type { NormalizedRow, SourceRow } from './import.types.js';

export function normalizeTimestamp(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(input.trim());
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, Number((match[7] ?? '').padEnd(3, '0')));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  const offset = match[8]!;
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (offsetHour > 23 || offsetMinute > 59) return null;
  const offsetMs = (offsetHour * 60 + offsetMinute) * 60_000 * (offset.startsWith('-') ? -1 : 1);
  const normalized = new Date(local.getTime() - offsetMs);
  if (normalized.getUTCFullYear() < 0 || normalized.getUTCFullYear() > 9999) return null;
  return normalized.toISOString();
}

function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}
function text(value: unknown): string | null {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? String(value).trim() : null;
}
export function normalizeRow(row: SourceRow, mapping: MappingRequest): { value: NormalizedRow } | { issue: ImportIssue; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const invalid = (field?: string) => { issues.push({ rowNumber: row.rowNumber, reason: 'INVALID_ROW', ...(field ? { field } : {}) }); };
  if (!row.structuralValid) { invalid(); return { issue: issues[0]!, issues }; }
  const get = (field: keyof MappingRequest['fieldMap']) => {
    const column = mapping.fieldMap[field];
    return column && Object.hasOwn(row.values, column) ? row.values[column] : undefined;
  };
  const externalId = text(get('sensorId'));
  if (!externalId) invalid('sensorId');
  const latitude = number(get('latitude')), longitude = number(get('longitude'));
  if (latitude === null || latitude < -90 || latitude > 90) invalid('latitude');
  if (longitude === null || longitude < -180 || longitude > 180) invalid('longitude');
  const ts = normalizeTimestamp(get('timestamp'));
  if (!ts) invalid('timestamp');
  const value = number(get('value'));
  if (value === null || value < 0) invalid('value');
  // Explicit mapping is authoritative; recognised source unit columns may not contradict
  // the globally confirmed ug/m3 unit even if the current FE does not map optional fields.
  const unitValues = mapping.fieldMap.unit ? [get('unit')] : Object.entries(row.values)
    .filter(([key]) => /^(?:unit|units|pm25unit)$/i.test(key.replace(/[\s_.-]/g, ''))).map(([, unit]) => unit);
  if (unitValues.some(unit => text(unit) !== 'ug/m3')) invalid('unit');
  if (issues.length) return { issue: issues[0]!, issues };
  const name = text(get('name')) || externalId!;
  const region = text(get('region'));
  return { value: { rowNumber: row.rowNumber, externalId: externalId!, latitude: latitude!, longitude: longitude!, ts: ts!, value: value!, name,
    ...(region ? { region } : {}),
  } };
}

export function mappingSuggestions(columns: Iterable<string>): Record<string, string> {
  const aliases: Record<string, string[]> = {
    sensorId: ['sensorid', 'stationid', 'stationcode', 'externalid', 'station'],
    latitude: ['latitude', 'lat'], longitude: ['longitude', 'lon', 'lng'],
    timestamp: ['timestamp', 'observedat', 'datetime', 'time', 'ts'], value: ['value', 'pm25', 'concentration'],
    unit: ['unit', 'units', 'pm25unit'], name: ['name', 'stationname'], region: ['region', 'area'],
  };
  const result: Record<string, string> = {};
  for (const [field, options] of Object.entries(aliases)) {
    const candidates = [...columns].filter(column => options.includes(column.toLowerCase().replace(/[^a-z0-9]/g, '')));
    if (candidates.length === 1) result[field] = candidates[0]!;
  }
  return result;
}
