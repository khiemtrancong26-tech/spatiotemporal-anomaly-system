// Existing OpenAPI only; contract.test.ts guards request/response/query drift.
const id = { type: 'string', minLength: 1 } as const;
const time = { type: 'string', format: 'date-time' } as const;
const status = { type: 'string', enum: ['open', 'confirmed', 'false_positive'] } as const;
const severity = { type: 'string', enum: ['low', 'medium', 'high'] } as const;
const family = { type: 'string', enum: ['statistical', 'ml'] } as const;
export const anomalySchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'datasetId', 'sensorId', 'readingId', 'analysisRunId', 'ts', 'location', 'family', 'method', 'score', 'severity', 'status', 'note', 'version', 'updatedAt'],
  properties: {
    id, datasetId: id, sensorId: id, readingId: id, analysisRunId: id, ts: time,
    location: { type: 'object', additionalProperties: false, required: ['type', 'coordinates'], properties: {
      type: { type: 'string', enum: ['Point'] }, coordinates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
    } },
    family, method: { type: 'string' }, score: { type: 'number' }, severity, status, note: { type: 'string' },
    version: { type: 'integer', minimum: 1 }, updatedAt: time,
  },
} as const;
export const reviewChangesSchema = { type: 'object', additionalProperties: false, minProperties: 1,
  properties: { status, note: { type: 'string' } },
} as const;
export const reviewRequestSchema = { type: 'object', additionalProperties: false, required: ['baseVersion', 'changes'],
  properties: { baseVersion: { type: 'integer', minimum: 1 }, changes: reviewChangesSchema },
} as const;
export const singleAnomalySchema = { type: 'object', additionalProperties: false, required: ['data'], properties: { data: anomalySchema } } as const;
export const anomalyPageSchema = { type: 'object', additionalProperties: false, required: ['data', 'page'], properties: {
  data: { type: 'array', items: anomalySchema },
  page: { type: 'object', additionalProperties: false, required: ['limit', 'nextCursor'], properties: {
    limit: { type: 'integer', minimum: 1 }, nextCursor: { type: 'string', nullable: true },
  } },
} } as const;
export const anomaliesQuerySchema = { type: 'object', additionalProperties: false, required: ['datasetId'], properties: {
  datasetId: id, analysisRunId: id, status, severity, family, method: id, from: time, to: time,
  sort: { type: 'string', enum: ['ts:asc', 'ts:desc'], default: 'ts:asc' },
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 }, cursor: { type: 'string' },
} } as const;
export const anomalyParamsSchema = { type: 'object', additionalProperties: false, required: ['id'], properties: { id } } as const;
