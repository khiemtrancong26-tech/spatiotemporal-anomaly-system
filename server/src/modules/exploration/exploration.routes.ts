import type { FastifyPluginAsync } from 'fastify';
import { errorSchema, HttpError } from '../../shared/http/errors.js';
import type { createExplorationService } from './exploration.service.js';
import type { ExplorationQuery } from './exploration.types.js';
import { profileParamsSchema, profileQuerySchema, aggregationQuerySchema, profileResponseSchema, aggregationResponseSchema } from './exploration.schema.js';
export function createExplorationRoutes(service: ReturnType<typeof createExplorationService>): FastifyPluginAsync {
  return async app => {
    const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 422: errorSchema, 500: errorSchema, 503: errorSchema };
    const normalize = async (request: { query: ExplorationQuery }) => {
      const ids: unknown = request.query.sensorIds;
      if (typeof ids === 'string') request.query.sensorIds = [ids];
      if (Array.isArray(ids) && new Set(ids).size !== ids.length) throw new HttpError(422, 'INVALID_SENSOR_IDS', 'Sensor IDs must be unique.');
    };
    app.get<{ Params: { id: string }; Querystring: ExplorationQuery }>('/datasets/:id/profile', {
      onRequest: app.authorize(['analyst', 'admin']), preValidation: normalize,
      schema: { params: profileParamsSchema, querystring: profileQuerySchema, response: { 200: profileResponseSchema, ...errors } },
    }, async (request, reply) => {
      const controller = new AbortController(), abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
      reply.raw.once('close', abort);
      try { return await service.profile(request.params.id, request.query, controller.signal, request.principal!); } finally { reply.raw.removeListener('close', abort); }
    });
    app.get<{ Querystring: ExplorationQuery }>('/reading-aggregates', {
      onRequest: app.authorize(['analyst', 'admin']), preValidation: normalize,
      schema: { querystring: aggregationQuerySchema, response: { 200: aggregationResponseSchema, ...errors } },
    }, async (request, reply) => {
      const controller = new AbortController(), abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
      reply.raw.once('close', abort);
      try { return await service.aggregates(request.query.datasetId!, request.query, controller.signal, request.principal!); } finally { reply.raw.removeListener('close', abort); }
    });
  };
}
