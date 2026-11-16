import type { FastifyPluginAsync } from 'fastify';
import { errorSchema } from '../../shared/http/errors.js';
import { listSorts, parsePageQuery } from '../../shared/pagination.js';
import { anomalyPageSchema, singleAnomalySchema, reviewRequestSchema, anomaliesQuerySchema, anomalyParamsSchema } from './anomalies.schema.js';
import type { createAnomalyService } from './anomalies.service.js';
import type { AnomaliesQuery, ReviewRequest } from './anomalies.types.js';

export function createAnomalyRoutes(service: ReturnType<typeof createAnomalyService>): FastifyPluginAsync {
  return async app => {
    const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 500: errorSchema };
    app.get<{ Querystring: AnomaliesQuery }>('/anomalies', {
      onRequest: app.authorize(['analyst', 'admin']),
      preValidation: async request => { parsePageQuery(request.query, listSorts.anomalies, 'ts:asc'); },
      schema: { querystring: anomaliesQuerySchema, response: { 200: anomalyPageSchema, ...errors, 409: errorSchema, 422: errorSchema } },
    }, request => service.list(request.query));
    app.get<{ Params: { id: string } }>('/anomalies/:id', {
      onRequest: app.authorize(['analyst', 'admin']), schema: { params: anomalyParamsSchema, response: { 200: singleAnomalySchema, ...errors, 404: errorSchema } },
    }, request => service.detail(request.params.id));
    app.patch<{ Params: { id: string }; Body: ReviewRequest }>('/anomalies/:id', {
      onRequest: app.authorize(['analyst', 'admin']), schema: { params: anomalyParamsSchema, body: reviewRequestSchema,
        response: { 200: singleAnomalySchema, ...errors, 404: errorSchema, 409: errorSchema, 422: errorSchema } },
    }, request => service.review(request.params.id, request.body));
  };
}
