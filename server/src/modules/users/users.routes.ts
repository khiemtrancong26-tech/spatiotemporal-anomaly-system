import type { FastifyPluginAsync } from 'fastify';
import { errorSchema } from '../../shared/http/errors.js';
import { userResponseSchema } from './users.schema.js';

export const currentUserRoutes: FastifyPluginAsync = async (app) => {
  app.get('/users/me', { preHandler: app.authenticate, schema: { response: {
    200: userResponseSchema, 401: errorSchema, 403: errorSchema, 500: errorSchema,
  } } }, async (request) => ({ data: await app.users.currentUser(request.principal!.id) }));
};
