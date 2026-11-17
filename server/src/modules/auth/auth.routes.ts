import type { FastifyPluginAsync } from 'fastify';
import { errorSchema } from '../../shared/http/errors.js';
import { userResponseSchema } from '../users/index.js';
import { loginRequestSchema, loginResponseSchema, registerRequestSchema, emailRequestSchema, tokenRequestSchema, resetRequestSchema, authMessageSchema } from './auth.schema.js';
import type { createEmailService } from './email.service.js';
import type { createAuthService } from './auth.service.js';

interface Credentials { username: string; password: string }
export function createAuthRoutes(service: ReturnType<typeof createAuthService>, rate: { max: number; windowMs: number }, email: ReturnType<typeof createEmailService>): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: Credentials & { email: string } }>('/auth/register', { config: { bodyValidationStatus: 422, rateLimit: { max: rate.max, timeWindow: rate.windowMs } }, schema: {
      body: registerRequestSchema, response: { 201: userResponseSchema, 400: errorSchema, 409: errorSchema, 422: errorSchema, 500: errorSchema, 503: errorSchema, 429: errorSchema },
    } }, async (request, reply) => reply.code(201).send({ data: await email.register(request.body) }));
    app.post<{ Body: Credentials }>('/auth/tokens', { config: { rateLimit: { max: rate.max, timeWindow: rate.windowMs } }, schema: {
      body: loginRequestSchema, response: { 200: loginResponseSchema, 400: errorSchema, 401: errorSchema, 403: errorSchema, 429: errorSchema, 500: errorSchema },
    } }, async (request) => service.login(request.body));
    for (const [path, body, handler] of [
      ['verify-email', tokenRequestSchema, (input: { token: string }) => email.verify(input.token)],
      ['resend-verification', emailRequestSchema, (input: { email: string }) => email.resend(input.email)],
      ['forgot-password', emailRequestSchema, (input: { email: string }) => email.resend(input.email, true)],
      ['reset-password', resetRequestSchema, (input: { token: string; newPassword: string }) => email.reset(input.token, input.newPassword)],
    ] as const) {
      app.post(`/auth/${path}`, { config: { bodyValidationStatus: 422, rateLimit: { max: rate.max, timeWindow: rate.windowMs } }, schema: { body,
        response: { 200: authMessageSchema, 400: errorSchema, 422: errorSchema, 429: errorSchema, 500: errorSchema } } },
      async request => handler(request.body as { token: string; email: string; newPassword: string }));
    }
  };
}
