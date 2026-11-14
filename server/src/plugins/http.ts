import fp from 'fastify-plugin';
import type { HTTPMethods } from 'fastify';
import { HttpError } from '../shared/http/errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    // Each future operation opts into 422 only where its OpenAPI responses allow it.
    bodyValidationStatus?: 400 | 422;
  }
}

export const httpPlugin = fp(async (app) => {
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string; validation?: unknown; validationContext?: string }, request, reply) => {
    if (error instanceof HttpError) {
      if (error.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer realm="pm25-api"');
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
    }
    if (error.validation) {
      const status = error.validationContext === 'body' ? request.routeOptions.config.bodyValidationStatus ?? 400 : 400;
      return reply.code(status).send({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.' } });
    }
    let status = error.statusCode;
    if (status && status >= 400 && status < 500) {
      // JSON-only auth operations declare 400 rather than upload-specific 413/415.
      // Respect that operation's response set without changing the OpenAPI contract.
      const responses = request.routeOptions.schema?.response as Record<string, unknown> | undefined;
      if (responses && !(String(status) in responses) && '400' in responses) status = 400;
      const known: Record<number, [string, string]> = {
        400: ['BAD_REQUEST', 'Invalid request syntax.'],
        413: ['CONTENT_TOO_LARGE', 'Request body is too large.'],
        415: ['UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type.'],
      };
      const [code, message] = known[status] ?? ['REQUEST_ERROR', 'Request rejected.'];
      return reply.code(status).send({ error: { code, message } });
    }
    // Driver/parser messages can contain credentials, raw payloads or connection strings.
    request.log.error({ event: 'request_failed' }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  });
  app.setNotFoundHandler((request, reply) => {
    // Fastify's router resolves parameterised paths; do not maintain a second path registry.
    // A CORS wildcard OPTIONS handler must not turn every unknown URL into a 405.
    const methods = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as HTTPMethods[])
      .filter((method) => app.findRoute({ method, url: request.url.split('?')[0] ?? '/' }));
    if (methods.length) {
      if (app.findRoute({ method: 'OPTIONS', url: request.url.split('?')[0] ?? '/' })) methods.push('OPTIONS');
      return reply.header('Allow', methods.join(', ')).code(405).send({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' },
      });
    }
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  });
}, { name: 'http' });
