import fp from 'fastify-plugin';
import { authPlugin, type VerifyAccessToken } from '../../plugins/auth.js';
import type { ServerConfig } from '../../config.js';
import { currentUserRoutes } from '../users/index.js';
import { createTokens } from './tokens.js';
import { createAuthService } from './auth.service.js';
import { createAuthRoutes } from './auth.routes.js';

export const authenticationPlugin = fp<{ config: ServerConfig; verifyAccessToken?: VerifyAccessToken }>(async (app, options) => {
  const tokens = createTokens(options.config.jwtSecret);
  const verifyAccessToken = options.verifyAccessToken ?? (async (token: string) => {
    const subject = await tokens.verify(token);
    return subject ? app.users.findActiveById(subject) : null;
  });
  await app.register(authPlugin, { verifyAccessToken });
  await app.register(createAuthRoutes(createAuthService(app.users, tokens), {
    max: options.config.loginRateMax, windowMs: options.config.loginRateWindowMs,
  }), { prefix: '/api/v1' });
  await app.register(currentUserRoutes, { prefix: '/api/v1' });
}, { name: 'authentication', dependencies: ['users', 'http', '@fastify/rate-limit'] });
