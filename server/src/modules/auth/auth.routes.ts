import type { FastifyPluginAsync } from 'fastify';
import { errorSchema } from '../../shared/http/errors.js';
import { userResponseSchema } from '../users/index.js';
import { loginRequestSchema, loginResponseSchema, registerRequestSchema } from './auth.schema.js';
import type { createAuthService } from './auth.service.js';

interface Credentials { username: string; password: string }
export function createAuthRoutes(service: ReturnType<typeof createAuthService>, rate: { max: number; windowMs: number }): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: Credentials }>('/auth/register', { config: { bodyValidationStatus: 422 }, schema: {
      body: registerRequestSchema, response: { 201: userResponseSchema, 400: errorSchema, 409: errorSchema, 422: errorSchema, 500: errorSchema },
    } }, async (request, reply) => reply.code(201).send({ data: await service.register(request.body) }));
    app.post<{ Body: Credentials }>('/auth/tokens', { config: { rateLimit: { max: rate.max, timeWindow: rate.windowMs } }, schema: {
      body: loginRequestSchema, response: { 200: loginResponseSchema, 400: errorSchema, 401: errorSchema, 429: errorSchema, 500: errorSchema },
    } }, async (request) => service.login(request.body));
  };
}
