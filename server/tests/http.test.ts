import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { VerifyAccessToken } from '../src/plugins/auth.js';

const apps: FastifyInstance[] = [];
function appForTest(verifyAccessToken?: VerifyAccessToken, logger?: NonNullable<Parameters<typeof buildApp>[0]>['logger']) {
  const config = loadConfig({ MONGODB_URI: 'mongodb://127.0.0.1:1/b1_unit', MONGODB_TIMEOUT_MS: '20', LOG_LEVEL: 'silent' });
  const app = buildApp({ config, logger: logger ?? false, ...(verifyAccessToken ? { verifyAccessToken } : {}) });
  apps.push(app);
  return app;
}
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('HTTP foundation using Fastify inject', () => {
  it('allows configured FE origins, supports preflight and keeps unknown paths as 404', async () => {
    const app = buildApp({ logger: false, config: loadConfig({
      MONGODB_URI: 'mongodb://127.0.0.1:1/b1_unit', MONGODB_TIMEOUT_MS: '20', CORS_ORIGINS: 'http://127.0.0.1:5173',
    }) });
    apps.push(app);
    const headers = { origin: 'http://127.0.0.1:5173' };
    const health = await app.inject({ url: '/api/v1/health', headers });
    expect(health.headers['access-control-allow-origin']).toBe(headers.origin);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/v1/health', headers: {
      ...headers, 'access-control-request-method': 'GET', 'access-control-request-headers': 'Authorization',
    } });
    expect(preflight.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/v1/health', headers: { origin: 'https://unknown.example' } })).headers['access-control-allow-origin']).toBeUndefined();
    expect((await app.inject({ url: '/api/v1/not-implemented', headers })).statusCode).toBe(404);
    const unsupported = await app.inject({ method: 'POST', url: '/api/v1/health', headers });
    expect(unsupported.statusCode).toBe(405);
    expect(unsupported.headers.allow).toBe('GET, OPTIONS');
  });

  it('exposes only GET health, reports unavailable MongoDB and has correct 404/405 envelopes', async () => {
    const app = appForTest();
    const response = await app.inject('/api/v1/health');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', timestamp: expect.stringMatching(/Z$/) });
    const unsupported = await app.inject({ method: 'POST', url: '/api/v1/health?check=1' });
    expect(unsupported.statusCode).toBe(405);
    expect(unsupported.headers.allow).toBe('GET');
    expect(unsupported.json().error.code).toBe('METHOD_NOT_ALLOWED');
    expect((await app.inject({ method: 'HEAD', url: '/api/v1/health' })).statusCode).toBe(405);
    for (const url of ['/health', '/api/v1/datasets', '/api/v1/reading-batches', '/api/v1/exports']) {
      expect((await app.inject(url)).statusCode).toBe(404);
    }
  });

  it('rejects extra JSON fields without stripping them and separates 400 syntax/query from opt-in 422', async () => {
    const app = appForTest();
    app.register(async (scope) => {
      scope.post('/test-validation', {
        config: { bodyValidationStatus: 422 },
        schema: {
          body: { type: 'object', required: ['username'], additionalProperties: false, properties: { username: { type: 'string', minLength: 1 } } },
          querystring: { type: 'object', additionalProperties: false },
        },
      }, async () => ({ success: true }));
      scope.get('/test-parameter/:id', async () => ({ success: true }));
      scope.addSchema({ $id: 'page-query-test', type: 'object', additionalProperties: false,
        properties: { limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 } } });
      scope.get<{ Querystring: { limit: number } }>('/test-page', {
        schema: { querystring: { $ref: 'page-query-test#' } },
      }, async (request) => ({ limit: request.query.limit }));
    });
    expect((await app.inject({ method: 'POST', url: '/test-validation', payload: { username: 'a' } })).statusCode).toBe(200);
    for (const payload of [{ username: 'a', role: 'admin' }, { username: 1 }, {}]) {
      expect((await app.inject({ method: 'POST', url: '/test-validation', payload })).statusCode).toBe(422);
    }
    const malformed = await app.inject({ method: 'POST', url: '/test-validation', headers: { 'content-type': 'application/json' }, payload: '{"password":"secret",' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('secret');
    expect((await app.inject({ method: 'POST', url: '/test-validation?bad=1', payload: { username: 'a' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/test-validation', headers: { 'content-type': 'text/unsupported' }, payload: 'bad' })).statusCode).toBe(415);
    const method = await app.inject({ method: 'POST', url: '/test-parameter/123' });
    expect(method.statusCode).toBe(405);
    expect(method.headers.allow).toBe('GET');
    expect((await app.inject('/test-page?limit=200')).json()).toEqual({ limit: 200 });
    expect((await app.inject('/test-page')).json()).toEqual({ limit: 100 });
    for (const query of ['limit=201', 'limit=1.5', 'limit=bad', 'limit=1&limit=2', 'other=1']) {
      expect((await app.inject(`/test-page?${query}`)).statusCode).toBe(400);
    }
  });

  it('sanitizes unexpected errors and redacts sensitive data from logs', async () => {
    let logs = '';
    const app = appForTest(undefined, { level: 'info', stream: { write: (chunk: string) => { logs += chunk; } } });
    app.register(async (scope) => {
      scope.get('/test-error', async (request) => {
        request.log.info({ password: 'private-password', context: { passwordHash: 'private-hash', accessToken: 'private-token' } }, 'Safe test event');
        throw new Error('mongodb://user:private-driver-password@db/internal-stack');
      });
    });
    const response = await app.inject({ url: '/test-error?token=private-query', headers: { authorization: 'Bearer private-header', cookie: 'private-cookie' } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    expect(logs).toContain('request_failed');
    expect(logs).toContain('[REDACTED]');
    for (const secret of ['private-password', 'private-hash', 'private-token', 'private-driver-password', 'private-query', 'private-header', 'private-cookie', 'internal-stack']) {
      expect(logs + response.body).not.toContain(secret);
    }
  });
});

describe('auth/RBAC hooks with an explicit verifier test double', () => {
  it('fails closed and checks active users/roles returned by verifier, never client headers', async () => {
    const app = appForTest(async (token) => {
      if (token === 'analyst-token') return { id: 'u1', role: 'analyst', isActive: true };
      if (token === 'admin-token') return { id: 'u2', role: 'admin', isActive: true };
      if (token === 'inactive-token') return { id: 'u3', role: 'admin', isActive: false };
      return null;
    });
    app.register(async (scope) => {
      scope.get('/test-protected', { preHandler: scope.authenticate }, async (request) => ({ id: request.principal?.id }));
      scope.get('/test-admin', { preHandler: scope.authorize(['admin']) }, async () => ({ ok: true }));
    });
    for (const authorization of ['', 'Basic x', 'Bearer unknown', 'Bearer inactive-token', 'Bearer analyst-token,admin-token']) {
      const result = await app.inject({ url: '/test-protected', headers: { authorization } });
      expect(result.statusCode).toBe(401);
      expect(result.headers['www-authenticate']).toContain('Bearer');
    }
    expect((await app.inject({ url: '/test-protected', headers: { authorization: 'Bearer analyst-token' } })).json()).toEqual({ id: 'u1' });
    expect((await app.inject({ url: '/test-admin', headers: { authorization: 'Bearer analyst-token', 'x-role': 'admin' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/test-admin', headers: { authorization: 'Bearer admin-token' } })).statusCode).toBe(200);
  });
  it('does not allow bearer tokens when B2 verification has not been configured', async () => {
    const app = appForTest();
    app.register(async (scope) => {
      scope.get('/test-protected', { preHandler: scope.authenticate }, async () => ({ ok: true }));
    });
    expect((await app.inject({ url: '/test-protected', headers: { authorization: 'Bearer any-token' } })).statusCode).toBe(503);
  });
});
