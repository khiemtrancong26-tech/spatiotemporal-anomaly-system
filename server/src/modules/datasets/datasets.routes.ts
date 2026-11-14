import type { FastifyPluginAsync } from 'fastify';
import { errorSchema } from '../../shared/http/errors.js';
import { datasetPageSchema, datasetQuerySchema } from './datasets.schema.js';
import type { createDatasetService } from './datasets.service.js';
import type { DatasetListQuery } from './datasets.types.js';

export function createDatasetRoutes(service: ReturnType<typeof createDatasetService>): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: DatasetListQuery }>('/datasets', {
      preHandler: app.authorize(['analyst', 'admin']),
      schema: { querystring: datasetQuerySchema, response: {
        200: datasetPageSchema, 400: errorSchema, 401: errorSchema, 403: errorSchema, 500: errorSchema,
      } },
    }, async (request) => service.list(request.query));
  };
}
