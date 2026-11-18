import { EmailRequestSchema } from '@pm25/shared-core';
import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../../shared/http/errors.js';
import type { createUserRepository } from '../users/users.repository.js';
import type { createUserService } from '../users/users.service.js';
import type { PasswordHasher } from '../users/passwords.js';
import type { EmailSender } from './email.js';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export const emailMessage = { message: 'If the account is eligible, an email may be sent. Check your inbox or try again later.' };
export function createEmailService(repository: ReturnType<typeof createUserRepository>, users: ReturnType<typeof createUserService>, passwords: PasswordHasher, sender: EmailSender,
  reportFailure: (stage: 'delivery' | 'release_cooldown', error: unknown) => void) {
  const tokenState = (reset: boolean) => { const raw = randomBytes(32).toString('hex'), now = new Date(); return { raw, state: { hash: digest(raw), expiresAt: new Date(+now + (reset ? 15 * 60000 : 24 * 3600000)), cooldownUntil: new Date(+now + 60000) } }; };
  const normalize = (email: string) => { const parsed = EmailRequestSchema.safeParse({ email }); if (!parsed.success || parsed.data.email.length > 254) throw new HttpError(422, 'VALIDATION_ERROR', 'Invalid email.'); return parsed.data.email; };
  async function delivery(email: string, raw: string, reset: boolean) {
    try { await (reset ? sender.reset(email, raw) : sender.verification(email, raw)); return true; }
    catch (error) {
      reportFailure('delivery', error);
      try { await repository.releaseEmailCooldown(digest(raw), reset ? 'passwordReset' : 'emailVerification'); }
      catch (cause) { reportFailure('release_cooldown', cause); }
      return false;
    }
  }
  return {
    async register(input: { username: string; email: string; password: string }) {
      const email = normalize(input.email), token = tokenState(false);
      const user = await users.createUser({ username: input.username, password: input.password, role: 'analyst', email, emailNormalized: email.toLowerCase(), emailVerificationRequired: true, emailVerifiedAt: null, emailVerification: token.state });
      if (!await delivery(email, token.raw, false)) throw new HttpError(503, 'REGISTRATION_EMAIL_FAILED', 'Account created and pending verification. Resend verification; do not register again.');
      return user;
    },
    async resend(email: string, reset = false) {
      const normalized = normalize(email).toLowerCase(), token = tokenState(reset);
      const recipient = await repository.issueEmailToken(normalized, reset ? 'passwordReset' : 'emailVerification', token.state, new Date());
      if (recipient) await delivery(recipient, token.raw, reset);
      return emailMessage;
    },
    async verify(token: string) {
      if (!await repository.verifyEmail(digest(token), new Date())) throw new HttpError(422, 'INVALID_EMAIL_TOKEN', 'Token invalid, expired or already used.');
      return { message: 'Email verified. Please log in.' };
    },
    async reset(token: string, newPassword: string) {
      if (Array.from(newPassword).length < 8) throw new HttpError(422, 'VALIDATION_ERROR', 'Password must contain at least 8 characters.');
      const passwordHash = await passwords.hash(newPassword);
      if (!await repository.resetPassword(digest(token), passwordHash, new Date())) throw new HttpError(422, 'INVALID_RESET_TOKEN', 'Token invalid, expired or already used.');
      return { message: 'Password changed. Please log in again.' };
    },
  };
}
