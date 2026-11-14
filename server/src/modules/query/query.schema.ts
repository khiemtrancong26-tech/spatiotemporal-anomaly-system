const id = { type: 'string', minLength: 1 } as const;
const point = {
  type: 'object', additionalProperties: false, required: ['type', 'coordinates'],
  properties: { type: { type: 'string', enum: ['Point'] },
    coordinates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } },
} as const;
export const sensorSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'datasetId', 'externalId', 'name', 'location', 'type', 'unit'],
  properties: { id, datasetId: id, externalId: { type: 'string' }, name: { type: 'string' }, location: point,
    type: { type: 'string', enum: ['pm25'] }, unit: { type: 'string', enum: ['ug/m3'] }, region: { type: 'string' } },
} as const;
export const readingSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'datasetId', 'sensorId', 'ts', 'location', 'value', 'unit'],
  properties: { id, datasetId: id, sensorId: id, ts: { type: 'string', format: 'date-time' }, location: point,
    value: { type: 'number', minimum: 0 }, unit: { type: 'string', enum: ['ug/m3'] } },
} as const;
function page(items: typeof sensorSchema | typeof readingSchema) {
  return { type: 'object', additionalProperties: false, required: ['data', 'page'], properties: {
    data: { type: 'array', items }, page: { type: 'object', additionalProperties: false, required: ['limit', 'nextCursor'],
      properties: { limit: { type: 'integer', minimum: 1 }, nextCursor: { type: 'string', nullable: true } } },
  } } as const;
}
export const sensorPageSchema = page(sensorSchema), readingPageSchema = page(readingSchema);
const pagination = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 }, cursor: { type: 'string' },
} as const;
export const sensorsQuerySchema = {
  type: 'object', additionalProperties: false, required: ['datasetId'],
  properties: { datasetId: id, bbox: { type: 'string' }, ...pagination,
    sort: { type: 'string', enum: ['externalId:asc', 'externalId:desc'], default: 'externalId:asc' } },
} as const;
export const readingsQuerySchema = {
  type: 'object', additionalProperties: false, required: ['datasetId'],
  properties: { datasetId: id, sensorId: id, bbox: { type: 'string' },
    from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' }, ...pagination,
    sort: { type: 'string', enum: ['ts:asc', 'ts:desc'], default: 'ts:asc' } },
} as const;
