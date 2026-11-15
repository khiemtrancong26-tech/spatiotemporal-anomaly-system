import type { FastifyPluginAsync } from 'fastify';
import { errorSchema } from '../../shared/http/errors.js';
import { listSorts, parsePageQuery } from '../../shared/pagination.js';
import { sensorPageSchema, readingPageSchema, sensorsQuerySchema, readingsQuerySchema } from './query.schema.js';
import type { createQueryService } from './query.service.js';
import type { SensorsQuery, ReadingsQuery } from './query.types.js';

export function createQueryRoutes(service: ReturnType<typeof createQueryService>): FastifyPluginAsync {
  return async app => {
    const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 422: errorSchema, 500: errorSchema };
    app.get<{ Querystring: SensorsQuery }>('/sensors', {
      preValidation: async request => { parsePageQuery(request.query, listSorts.sensors, 'externalId:asc'); },
      onRequest: app.authorize(['analyst', 'admin']), schema: { querystring: sensorsQuerySchema, response: { 200: sensorPageSchema, ...errors } },
    }, request => service.sensors(request.query));
    app.get<{ Querystring: ReadingsQuery }>('/readings', {
      preValidation: async request => { parsePageQuery(request.query, listSorts.readings, 'ts:asc'); },
      onRequest: app.authorize(['analyst', 'admin']), schema: { querystring: readingsQuerySchema, response: { 200: readingPageSchema, ...errors } },
    }, request => service.readings(request.query));
  };
}
