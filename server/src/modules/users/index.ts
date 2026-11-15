import fp from 'fastify-plugin';
import { createPasswordHasher } from './passwords.js';
import { createUserRepository } from './users.repository.js';
import { createUserService } from './users.service.js';

declare module 'fastify' {
  interface FastifyInstance { users: ReturnType<typeof createUserService> }
}
export const usersPlugin = fp(async (app) => {
  app.decorate('users', createUserService(createUserRepository(app.mongo.db), createPasswordHasher()));
}, { name: 'users', dependencies: ['mongo'] });
export { currentUserRoutes } from './users.routes.js';
export { createUserRepository } from './users.repository.js';
export { createUserService, normalizeUsername } from './users.service.js';
export { createPasswordHasher } from './passwords.js';
export type { UserPublic, UserRole } from './users.types.js';
export { userPublicSchema, userResponseSchema } from './users.schema.js';
