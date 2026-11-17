import { HttpError } from '../../shared/http/errors.js';
import type { createUserService } from '../users/index.js';
import type { createTokens } from './tokens.js';

export function createAuthService(users: ReturnType<typeof createUserService>, tokens: ReturnType<typeof createTokens>) {
  return {
    async login(input: { username: string; password: string }) {
      const session = await users.authenticateSession(input.username, input.password);
      const user = session?.user;
      if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
      return { accessToken: await tokens.issue(user.id, session!.authVersion), tokenType: 'Bearer' as const, user };
    },
  };
}
