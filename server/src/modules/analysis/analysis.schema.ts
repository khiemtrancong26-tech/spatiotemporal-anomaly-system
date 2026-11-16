// Mirrors existing OpenAPI; contract.test.ts guards drift. No policy defaults here.
const id = { type: 'string', minLength: 1 } as const;
const time = { type: 'string', format: 'date-time' } as const;
const family = { type: 'string', enum: ['statistical', 'ml'] } as const;
const config = { type: 'object', additionalProperties: true } as const;
const scope = { type: 'object', additionalProperties: false, properties: {
  sensorIds: { type: 'array', items: id }, from: time, to: time,
} } as const;
export const detectionRequestSchema = {
  type: 'object', additionalProperties: false, required: ['datasetId', 'family', 'method', 'config'],
  properties: { datasetId: id, family, method: { type: 'string' }, config, scope },
} as const;
export const analysisRunSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'datasetId', 'family', 'method', 'config', 'status', 'createdAt', 'scope'],
  properties: { id, datasetId: id, family, method: { type: 'string' }, config, scope,
    error: { type: 'object', additionalProperties: false, required: ['code', 'message'], properties: { code: id, message: id } },
    status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
    createdAt: time, completedAt: time, engineVersion: { type: 'string' }, modelVersion: { type: 'string' },
  },
  allOf: [{ oneOf: [
    { properties: { status: { enum: ['queued', 'running'] } }, not: { anyOf: [{ required: ['completedAt'] }, { required: ['error'] }] } },
    { properties: { status: { enum: ['completed'] } }, required: ['completedAt'], not: { required: ['error'] } },
    { properties: { status: { enum: ['failed'] } }, required: ['completedAt', 'error'] },
  ] }],
} as const;
export const analysisResponseSchema = { type: 'object', additionalProperties: false, required: ['data'], properties: { data: analysisRunSchema } } as const;
export const analysisPageSchema = { type: 'object', additionalProperties: false, required: ['data', 'page'], properties: {
  data: { type: 'array', items: analysisRunSchema },
  page: { type: 'object', additionalProperties: false, required: ['limit', 'nextCursor'], properties: {
    limit: { type: 'integer', minimum: 1 }, nextCursor: { type: 'string', nullable: true },
  } },
} } as const;
export const historyQuerySchema = {
  type: 'object', additionalProperties: false, required: ['datasetId'], properties: {
    datasetId: id, sort: { type: 'string', enum: ['createdAt:asc', 'createdAt:desc'], default: 'createdAt:desc' },
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 }, cursor: { type: 'string' },
  },
} as const;
