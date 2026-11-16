import { HttpError } from '../../shared/http/errors.js';
import type { createUserService } from '../users/index.js';
import type { createTokens } from './tokens.js';

export function createAuthService(users: ReturnType<typeof createUserService>, tokens: ReturnType<typeof createTokens>) {
  return {
    register: (input: { username: string; password: string }) => users.createUser({ username: input.username, password: input.password, role: 'analyst' }),
    async login(input: { username: string; password: string }) {
      const user = await users.authenticate(input.username, input.password);
      if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
      return { accessToken: await tokens.issue(user.id), tokenType: 'Bearer' as const, user };
    },
  };
}
