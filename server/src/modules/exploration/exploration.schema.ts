import { z } from 'zod';
import { DatasetProfileSchema, ReadingAggregationSchema } from '@pm25/shared-core';
const id = { type: 'string', minLength: 1 };
const filters = { sensorIds: { type: 'array', minItems: 1, maxItems: 10000, uniqueItems: true, items: id }, bbox: { type: 'string' },
  from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } };
function response(schema: typeof DatasetProfileSchema | typeof ReadingAggregationSchema) {
  const json = z.toJSONSchema(z.object({ data: schema }).strict(), { target: 'draft-7', unrepresentable: 'any' });
  delete json.$schema; return json;
}
export const profileResponseSchema = response(DatasetProfileSchema), aggregationResponseSchema = response(ReadingAggregationSchema);
export const profileQuerySchema = { type: 'object', additionalProperties: false, required: [], properties: filters };
export const aggregationQuerySchema = { type: 'object', additionalProperties: false, required: ['datasetId', 'from', 'to', 'bucket'],
  properties: { datasetId: id, ...filters, bucket: { type: 'string', enum: ['hour', 'day'] }, timeZone: { type: 'string', enum: ['UTC', '+07:00', '+08:00'] } } };
export const profileParamsSchema = { type: 'object', additionalProperties: false, required: ['id'], properties: { id } };
