import fp from 'fastify-plugin';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import { HttpError } from '../shared/http/errors.js';

export type Role = 'analyst' | 'admin';
export interface Principal { id: string; role: Role; isActive: boolean }
// B2 must supply JWT signature/expiry verification AND current account lookup.
export type VerifyAccessToken = (token: string) => Promise<Principal | null>;

declare module 'fastify' {
  interface FastifyRequest { principal: Principal | null }
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    authorize: (roles: readonly Role[]) => preHandlerHookHandler;
  }
}

export const authPlugin = fp<{ verifyAccessToken?: VerifyAccessToken }>(async (app, options) => {
  app.decorateRequest('principal', null);
  async function authenticate(request: FastifyRequest) {
    const match = /^Bearer ([^\s,]+)$/i.exec(request.headers.authorization ?? '');
    if (!match?.[1]) throw new HttpError(401, 'UNAUTHORIZED', 'Valid authentication is required.');
    if (!options.verifyAccessToken) throw new HttpError(503, 'AUTH_UNAVAILABLE', 'Authentication is not configured.');
    const principal = await options.verifyAccessToken(match[1]);
    if (!principal?.id || !principal.isActive || !['analyst', 'admin'].includes(principal.role)) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Valid authentication is required.');
    }
    request.principal = principal;
  }
  app.decorate('authenticate', authenticate);
  app.decorate('authorize', (roles: readonly Role[]) => async (request: FastifyRequest) => {
    await authenticate(request);
    if (!request.principal || !roles.includes(request.principal.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'Insufficient permission.');
    }
  });
}, { name: 'auth', dependencies: ['http'] });
