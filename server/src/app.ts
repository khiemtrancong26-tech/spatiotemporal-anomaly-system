import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig, type ServerConfig } from './config.js';
import type { VerifyAccessToken } from './plugins/auth.js';
import { httpPlugin } from './plugins/http.js';
import { mongoPlugin } from './plugins/mongo.js';
import { healthRoutes } from './modules/health/index.js';
import { buildHttpValidator } from './shared/http/validation.js';
import { usersPlugin } from './modules/users/index.js';
import { authenticationPlugin } from './modules/auth/index.js';
import { datasetRoutes } from './modules/datasets/index.js';
import { HttpError } from './shared/http/errors.js';
import type { ImportTestHooks } from './modules/datasets/import.types.js';

interface AppOptions {
  config?: ServerConfig;
  logger?: FastifyServerOptions['logger'];
  verifyAccessToken?: VerifyAccessToken;
  importTestHooks?: ImportTestHooks;
}

export function buildApp(options: AppOptions = {}) {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    exposeHeadRoutes: false,
    schemaController: { compilersFactory: { buildValidator: buildHttpValidator } },
    logger: options.logger === false ? false : {
      level: config.logLevel,
      ...typeof options.logger === 'object' ? options.logger : {},
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
          'password', 'passwordHash', 'accessToken', 'token', 'jwtSecret', 'cursorSecret', 'mongodbUri',
          '*.password', '*.passwordHash', '*.accessToken', '*.token', '*.jwtSecret', '*.cursorSecret', '*.mongodbUri'],
        censor: '[REDACTED]',
      },
      serializers: {
        req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url.split('?')[0] ?? '/' }),
        err: () => ({ type: 'Error', message: 'Error details omitted', stack: '' }),
      },
    },
  });
  app.register(httpPlugin);
  if (config.corsOrigins.length) app.register(cors, {
    origin: config.corsOrigins,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Accept', 'Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['WWW-Authenticate', 'Allow', 'Retry-After'],
  });
  app.register(mongoPlugin, { config });
  app.register(rateLimit, { global: false, hook: 'onRequest', keyGenerator: request => request.ip,
    errorResponseBuilder: () => new HttpError(429, 'RATE_LIMITED', 'Too many login attempts. Please try again later.'),
  });
  app.register(usersPlugin);
  app.register(authenticationPlugin, { config, ...(options.verifyAccessToken ? { verifyAccessToken: options.verifyAccessToken } : {}) });
  app.register(healthRoutes, { prefix: '/api/v1' });
  app.register(datasetRoutes, { prefix: '/api/v1', cursorSecret: config.cursorSecret, imports: config.imports,
    ...(options.importTestHooks ? { importTestHooks: options.importTestHooks } : {}) });
  return app;
}
