import { ReadingSchema, type Reading } from '@pm25/shared-core/contracts';
import { EngineError } from './python-runner.js';

export interface ScoredPoint { readingId: string; score: number; flagged: boolean; reason?: string | undefined }
/** Internal pre-persistence projection, deliberately not an Anomaly/AnalysisRun DTO. */
export interface Candidate extends Omit<Reading, 'id'> { readingId: string; score: number; reason?: string }
export function validateReadings(readings: readonly Reading[]): Map<string, Reading> {
  const byId = new Map<string, Reading>(), keys = new Set<string>(); let datasetId: string | undefined;
  for (const raw of readings) {
    const parsed = ReadingSchema.safeParse(raw);
    if (!parsed.success) throw new EngineError('ENGINE_INPUT_INVALID', 'Engine input must contain normalized readings.');
    const reading = parsed.data, key = JSON.stringify([reading.sensorId, Date.parse(reading.ts)]);
    if (byId.has(reading.id) || keys.has(key) || (datasetId !== undefined && datasetId !== reading.datasetId)) throw new EngineError('ENGINE_INPUT_INVALID', 'Engine scope must have one dataset and unique reading IDs/station instants.');
    datasetId = reading.datasetId; byId.set(reading.id, reading); keys.add(key);
  }
  return byId;
}
export function projectCandidates(readings: readonly Reading[], points: readonly ScoredPoint[]): Candidate[] {
  const byId = validateReadings(readings), seen = new Set<string>(), candidates: Candidate[] = [];
  for (const point of points) {
    const reading = byId.get(point.readingId);
    if (!reading || seen.has(point.readingId) || !Number.isFinite(point.score) || typeof point.flagged !== 'boolean' || (point.reason !== undefined && typeof point.reason !== 'string')) {
      throw new EngineError('ENGINE_OUTPUT_INVALID', 'Engine output has invalid/foreign/duplicate references or scores.');
    }
    seen.add(point.readingId);
    if (point.flagged) candidates.push({ readingId: reading.id, datasetId: reading.datasetId, sensorId: reading.sensorId, ts: reading.ts, value: reading.value, unit: reading.unit,
      location: { type: 'Point', coordinates: [...reading.location.coordinates] }, score: point.score,
      ...(point.reason !== undefined ? { reason: point.reason } : {}) });
  }
  return candidates;
}
