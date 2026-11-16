import { z } from 'zod';
import { IdSchema, UtcIsoSchema } from './schemas.js';

export const ExplorationTimeZoneSchema = z.enum(['UTC', '+07:00', '+08:00']);
export type ExplorationTimeZone = z.infer<typeof ExplorationTimeZoneSchema>;
const count = z.number().int().nonnegative();
export const SamplingSchema = z.object({ cadenceSeconds: z.number().int().positive().max(Math.floor(Number.MAX_SAFE_INTEGER / 1000)), anchor: UtcIsoSchema,
  expectedFrom: UtcIsoSchema, expectedTo: UtcIsoSchema }).strict();
export const ExplorationMetadataInputSchema = z.object({ timeZone: ExplorationTimeZoneSchema,
  provenance: z.string().min(1), sampling: SamplingSchema.nullable() }).strict().refine(
  m => !m.sampling || Date.parse(m.sampling.expectedFrom) <= Date.parse(m.sampling.expectedTo), 'Expected interval is reversed');
export const ExplorationMetadataSchema = z.object({ version: z.number().int().positive().nullable(),
  timeZone: ExplorationTimeZoneSchema, source: z.enum(['configured', 'fallback']), provenance: z.string().nullable(),
  sampling: SamplingSchema.nullable() }).strict();
export const ExplorationScopeSchema = z.object({ sensorIds: z.array(IdSchema).nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  from: UtcIsoSchema.nullable(), to: UtcIsoSchema.nullable() }).strict();
export const CoverageSchema = z.object({ status: z.enum(['known', 'unknown', 'not_applicable']),
  expectedSlots: count.nullable(), observedSlots: count.nullable(), missingSlots: count.nullable(),
  unexpectedReadings: count.nullable(), ratio: z.number().min(0).max(1).nullable(), reason: z.string().nullable() }).strict();
const statistics = { min: z.number().nullable(), max: z.number().nullable(), mean: z.number().nullable() };
export const ExplorationSummarySchema = z.object({ readingCount: count, sensorCount: count, sensorsWithReadings: count,
  observedFrom: UtcIsoSchema.nullable(), observedTo: UtcIsoSchema.nullable(), ...statistics, coverage: CoverageSchema }).strict();
export const SourceQualitySchema = z.object({ status: z.enum(['known', 'unknown']), totalRows: count.nullable(),
  importedRows: count.nullable(), invalidRows: count.nullable(), duplicateRows: count.nullable(), conflictingRows: count.nullable(),
  missingValueRows: count.nullable(), reason: z.string() }).strict();
export const DatasetProfileSchema = z.object({ datasetId: IdSchema, scope: ExplorationScopeSchema,
  metadata: ExplorationMetadataSchema, dataset: ExplorationSummarySchema, scoped: ExplorationSummarySchema,
  sourceQuality: SourceQualitySchema, complete: z.literal(true) }).strict();
export const ReadingBucketSchema = z.object({ start: UtcIsoSchema, end: UtcIsoSchema, count, ...statistics, coverage: CoverageSchema }).strict();
export const ReadingAggregationSchema = z.object({ datasetId: IdSchema, scope: ExplorationScopeSchema,
  bucket: z.enum(['hour', 'day']), timeZone: ExplorationTimeZoneSchema, metadataVersion: z.number().int().positive().nullable(),
  series: z.array(z.object({ sensorId: IdSchema, buckets: z.array(ReadingBucketSchema) }).strict()), complete: z.literal(true) }).strict();
export type DatasetProfile = z.infer<typeof DatasetProfileSchema>;
export type ReadingAggregation = z.infer<typeof ReadingAggregationSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type ExplorationMetadata = z.infer<typeof ExplorationMetadataSchema>;
export type Sampling = z.infer<typeof SamplingSchema>;
export type ExplorationScope = z.infer<typeof ExplorationScopeSchema>;

export const explorationOffset = (zone: ExplorationTimeZone) => zone === 'UTC' ? 0 : zone === '+08:00' ? 8 : 7;
export function explorationLocalTime(utc: string, zone: ExplorationTimeZone): string {
  return new Date(Date.parse(utc) + explorationOffset(zone) * 3600000).toISOString().slice(0, 19);
}
export function explorationUtcTime(local: string, zone: ExplorationTimeZone): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(local)) throw new Error('Ngày giờ chưa đúng định dạng.');
  const value = local.length === 16 ? local + ':00' : local;
  const date = new Date(value + (zone === 'UTC' ? 'Z' : zone));
  if (!Number.isFinite(date.getTime()) || explorationLocalTime(date.toISOString(), zone) !== value) throw new Error('Ngày giờ không hợp lệ.');
  return date.toISOString();
}
