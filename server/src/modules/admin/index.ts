import type { FastifyPluginAsync } from 'fastify';
import { requireIdempotencyKey } from '../../shared/idempotency.js';
import { createCursorCodec, parsePageQuery, listSorts } from '../../shared/pagination.js';
import { errorSchema } from '../../shared/http/errors.js';
import { userResponseSchema, type UserRole } from '../users/index.js';
import { createAdminRepository } from './admin.repository.js';
import { createAdminService } from './admin.service.js';
import { adminCreateSchema, adminQuerySchema, adminUpdateSchema, userPageSchema } from './admin.schema.js';
export const adminRoutes: FastifyPluginAsync<{ cursorSecret: string }> = async (app, options) => {
  const service = createAdminService(createAdminRepository(app.mongo.client, app.mongo.db), app.users, createCursorCodec(options.cursorSecret));
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 500: errorSchema };
  app.get<{ Querystring: { sort?: string; limit?: number; cursor?: string } }>('/admin/users', { onRequest: app.authorize(['admin']),
    preValidation: async request => { parsePageQuery(request.query, listSorts.users, 'username:asc'); },
    schema: { querystring: adminQuerySchema, response: { ...errors, 200: userPageSchema } } }, request => service.list(request.query));
  app.post<{ Body: { username: string; password: string; role: UserRole } }>('/admin/users', { onRequest: app.authorize(['admin']), config: { bodyValidationStatus: 422 },
    preValidation: async request => { requireIdempotencyKey(request.headers['idempotency-key']); },
    schema: { body: adminCreateSchema, response: { ...errors, 201: userResponseSchema, 409: errorSchema, 422: errorSchema } } }, async (request, reply) => {
    const response = await service.create(request.principal!.id, request.headers['idempotency-key'], request.body); return reply.code(response.statusCode).send(response.body);
  });
  app.patch<{ Params: { id: string }; Body: { role?: UserRole; isActive?: boolean } }>('/admin/users/:id', { onRequest: app.authorize(['admin']), config: { bodyValidationStatus: 422 },
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } }, body: adminUpdateSchema,
      response: { ...errors, 200: userResponseSchema, 404: errorSchema, 409: errorSchema, 422: errorSchema } } }, request => service.update(request.principal!.id, request.params.id, request.body));
};
