import type { FastifyPluginAsync } from 'fastify';
import { errorSchema } from '../../shared/http/errors.js';
import { requireIdempotencyKey } from '../../shared/idempotency.js';
import { listSorts, parsePageQuery } from '../../shared/pagination.js';
import { detectionRequestSchema, analysisResponseSchema, analysisPageSchema, historyQuerySchema } from './analysis.schema.js';
import type { createAnalysisService } from './analysis.service.js';
import type { DetectionRequest, HistoryQuery } from './analysis.types.js';

export function createAnalysisRoutes(service: ReturnType<typeof createAnalysisService>): FastifyPluginAsync {
  return async app => {
    const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 405: errorSchema, 500: errorSchema };
    app.post<{ Body: DetectionRequest }>('/analysis-runs', {
      onRequest: app.authorize(['analyst', 'admin']),
      preValidation: async request => { requireIdempotencyKey(request.headers['idempotency-key']); },
      schema: { body: detectionRequestSchema, response: { 202: analysisResponseSchema, ...errors, 404: errorSchema, 409: errorSchema, 422: errorSchema, 503: errorSchema } },
    }, async (request, reply) => {
      const result = await service.create(request.principal!.id, request.headers['idempotency-key'], request.body);
      return reply.code(result.statusCode).send(result.body);
    });
    app.get<{ Params: { id: string } }>('/analysis-runs/:id', {
      onRequest: app.authorize(['analyst', 'admin']), schema: {
        params: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1 } } },
        response: { 200: analysisResponseSchema, ...errors, 404: errorSchema },
      },
    }, request => service.detail(request.params.id));
    app.get<{ Querystring: HistoryQuery }>('/analysis-runs', {
      onRequest: app.authorize(['analyst', 'admin']),
      preValidation: async request => { parsePageQuery(request.query, listSorts.analysisRuns, 'createdAt:desc'); },
      schema: { querystring: historyQuerySchema, response: { 200: analysisPageSchema, ...errors } },
    }, request => service.history(request.query));
  };
}
