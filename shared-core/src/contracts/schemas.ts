/**
 * Shared Data Contract v0.1 — starting point for Khai + Khiem review.
 * Pure TypeScript + Zod. No Backend, MongoDB, Browser or Node imports.
 * API routes/envelopes and physical persistence are deliberately out of scope.
 * To use: add `zod` to shared-core dependencies in its own package initialization.
 */
import { z } from 'zod';

export const IdSchema = z.string().min(1);

// UTC ISO 8601 with Z. Data source timestamps can carry an offset BEFORE normalization.
export const UtcIsoSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
  'Expected UTC ISO 8601 ending in Z',
).refine((s) => {
  const value = new Date(s);
  if (Number.isNaN(value.getTime())) return false;
  const p = value.toISOString();
  // Prevent silently accepting dates normalized by JavaScript, e.g. February 31.
  return p.slice(0, 19) === s.slice(0, 19);
}, 'Invalid UTC date/time');

export const LongitudeSchema = z.number().finite().min(-180).max(180);
export const LatitudeSchema = z.number().finite().min(-90).max(90);
export const GeoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([LongitudeSchema, LatitudeSchema]),
}).strict();

export const UserRoleSchema = z.enum(['analyst', 'admin']);
export const UserPublicSchema = z.object({
  id: IdSchema,
  username: z.string().min(1),
  role: UserRoleSchema,
  isActive: z.boolean(),
}).strict();

// Draft lifecycle enum; finalize during API Contract review.
export const DatasetStatusSchema = z.enum([
  'uploaded', 'awaiting_mapping', 'importing', 'imported', 'failed',
]);
export const ImportIssueReasonSchema = z.enum([
  'DUPLICATE_SAME_VALUE', 'DUPLICATE_VALUE_CONFLICT', 'INVALID_ROW',
]);
export const ImportIssueSchema = z.object({
  rowNumber: z.number().int().positive(),
  reason: ImportIssueReasonSchema,
  field: z.string().optional(),
  keptRowNumber: z.number().int().positive().optional(),
}).strict();
export const ImportSummarySchema = z.object({
  totalRows: z.number().int().nonnegative(),
  importedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  conflictingRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  issues: z.array(ImportIssueSchema),
}).strict();
export const DatasetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  sourceFilename: z.string().min(1),
  status: DatasetStatusSchema,
  createdBy: IdSchema,
  createdAt: UtcIsoSchema,
  importSummary: ImportSummarySchema.optional(),
}).strict();

export const SensorSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  externalId: z.string().min(1),
  name: z.string().min(1),
  location: GeoPointSchema,
  type: z.literal('pm25'),
  unit: z.literal('ug/m3'),
  region: z.string().optional(),
}).strict();

export const ReadingSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  sensorId: IdSchema, // Internal Sensor.id, never externalId from CSV.
  ts: UtcIsoSchema,
  location: GeoPointSchema,
  value: z.number().finite().nonnegative(),
  unit: z.literal('ug/m3'),
}).strict();

export const AnalysisFamilySchema = z.enum(['statistical', 'ml']);
export const StatisticalMethodSchema = z.enum(['zscore', 'iqr', 'moving_avg']);
export const AnalysisRunStatusSchema = z.enum(['running', 'completed', 'failed']);
export const AnalysisRunSchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  family: AnalysisFamilySchema,
  method: z.string().min(1), // ML model/method not finalized.
  config: z.object({}).passthrough(),
  status: AnalysisRunStatusSchema,
  createdAt: UtcIsoSchema,
  completedAt: UtcIsoSchema.optional(),
  engineVersion: z.string().optional(),
  modelVersion: z.string().optional(),
}).strict();

export const ReviewStatusSchema = z.enum(['open', 'confirmed', 'false_positive']);
export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export const AnomalySchema = z.object({
  id: IdSchema,
  datasetId: IdSchema,
  sensorId: IdSchema,
  readingId: IdSchema,
  analysisRunId: IdSchema,
  ts: UtcIsoSchema,
  location: GeoPointSchema,
  family: AnalysisFamilySchema,
  method: z.string().min(1),
  score: z.number().finite(),
  severity: SeveritySchema, // Mapping score -> severity is still OPEN-04.
  status: ReviewStatusSchema,
  note: z.string(),
  version: z.number().int().positive(),
  updatedAt: UtcIsoSchema,
}).strict();

// Offline mutation only applies to an EXISTING server Anomaly.
export const AnomalyReviewChangesSchema = z.object({
  status: ReviewStatusSchema.optional(),
  note: z.string().optional(),
}).strict().refine((changes) => changes.status !== undefined || changes.note !== undefined, {
  message: 'At least status or note is required',
});
export const OfflineReviewMutationSchema = z.object({
  clientMutationId: IdSchema,
  anomalyId: IdSchema,
  baseVersion: z.number().int().positive(),
  changes: AnomalyReviewChangesSchema,
  createdAt: UtcIsoSchema,
}).strict();

export const BboxSchema = z.tuple([
  LongitudeSchema, LatitudeSchema, LongitudeSchema, LatitudeSchema,
]).refine(([minLon, minLat, maxLon, maxLat]) => minLon <= maxLon && minLat <= maxLat, {
  message: 'bbox must be [minLon,minLat,maxLon,maxLat]',
});
export const CacheCoverageSchema = z.object({
  datasetId: IdSchema,
  cachedAt: UtcIsoSchema,
  storedReadingCount: z.number().int().nonnegative(),
  complete: z.boolean(), // Complete ONLY within specified scope.
  from: UtcIsoSchema.optional(),
  to: UtcIsoSchema.optional(),
  bbox: BboxSchema.optional(),
  sensorIds: z.array(IdSchema).optional(),
}).strict();

// Detector contract: deterministic, shared by Server and Web Worker.
export const StatisticalDetectorInputSchema = z.object({
  method: StatisticalMethodSchema,
  readings: z.array(ReadingSchema),
  config: z.object({
    threshold: z.number().finite().optional(),
    windowSize: z.number().int().min(2).optional(),
  }).strict(),
}).strict();
export const StatisticalDetectorPointSchema = z.object({
  readingId: IdSchema,
  method: StatisticalMethodSchema,
  score: z.number().finite(),
  flagged: z.boolean(),
  reason: z.string().optional(),
}).strict();
export const StatisticalDetectorOutputSchema = z.object({
  method: StatisticalMethodSchema,
  status: z.enum(['completed', 'insufficient_data', 'invalid_input']),
  results: z.array(StatisticalDetectorPointSchema),
  message: z.string().optional(),
}).strict();

// Typing only; Zod object validation cannot ensure relational references, unique
// composite keys, permissions, or version conflicts without Backend context.
export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserPublic = z.infer<typeof UserPublicSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;
export type Sensor = z.infer<typeof SensorSchema>;
export type Reading = z.infer<typeof ReadingSchema>;
export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;
export type Anomaly = z.infer<typeof AnomalySchema>;
export type ImportIssue = z.infer<typeof ImportIssueSchema>;
export type ImportSummary = z.infer<typeof ImportSummarySchema>;
export type OfflineReviewMutation = z.infer<typeof OfflineReviewMutationSchema>;
export type CacheCoverage = z.infer<typeof CacheCoverageSchema>;
export type StatisticalDetectorInput = z.infer<typeof StatisticalDetectorInputSchema>;
export type StatisticalDetectorOutput = z.infer<typeof StatisticalDetectorOutputSchema>;
export type GeoPoint = z.infer<typeof GeoPointSchema>;
