import { createEmailSender, type EmailSender } from './email.js';
import { createEmailService } from './email.service.js';
import { createUserRepository, createPasswordHasher } from '../users/index.js';
import fp from 'fastify-plugin';
import { authPlugin, type VerifyAccessToken } from '../../plugins/auth.js';
import type { ServerConfig } from '../../config.js';
import { currentUserRoutes } from '../users/index.js';
import { createTokens } from './tokens.js';
import { createAuthService } from './auth.service.js';
import { createAuthRoutes } from './auth.routes.js';

export const authenticationPlugin = fp<{ config: ServerConfig; verifyAccessToken?: VerifyAccessToken; emailSender?: EmailSender }>(async (app, options) => {
  if (!options.emailSender && (!options.config.email.apiKey || !options.config.email.from || !options.config.email.appUrl)) app.log.warn('Email delivery not configured: RESEND_API_KEY, RESEND_FROM_EMAIL and PUBLIC_APP_URL required; legacy login remains available.');
  const tokens = createTokens(options.config.jwtSecret);
  const verifyAccessToken = options.verifyAccessToken ?? (async (token: string) => {
    const session = await tokens.verifySession(token);
    return session ? app.users.authenticateToken(session.id, session.version) : null;
  });
  await app.register(authPlugin, { verifyAccessToken });
  await app.register(createAuthRoutes(createAuthService(app.users, tokens), {
    max: options.config.loginRateMax, windowMs: options.config.loginRateWindowMs,
  }, createEmailService(createUserRepository(app.mongo.db), app.users, createPasswordHasher(), options.emailSender ?? createEmailSender(options.config.email), () => app.log.warn('Transactional email failed; check configuration/provider.'))), { prefix: '/api/v1' });
  await app.register(currentUserRoutes, { prefix: '/api/v1' });
}, { name: 'authentication', dependencies: ['users', 'http', '@fastify/rate-limit'] });
