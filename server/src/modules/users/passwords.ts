import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createTaskLimiter } from '../../shared/concurrency.js';

const parameters = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const saltBytes = 16;
const keyBytes = 64;
const prefix = '$scrypt$131072$8$1$';
const runPasswordWork = createTaskLimiter(2);
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return runPasswordWork(() => new Promise((resolve, reject) => {
    scrypt(password, salt, keyBytes, parameters, (error, key) => { if (error) reject(error); else resolve(key); });
  }));
}
export interface PasswordHasher {
  hash: (password: string) => Promise<string>;
  verify: (password: string, encoded: string) => Promise<boolean>;
  dummyHash: string;
}
export function createPasswordHasher(): PasswordHasher {
  return {
    // Same-cost comparison for unknown users, without a special fast error path.
    dummyHash: `${prefix}${Buffer.alloc(saltBytes).toString('base64url')}$${Buffer.alloc(keyBytes).toString('base64url')}`,
    async hash(password) {
      const salt = randomBytes(saltBytes);
      const derived = await derive(password, salt);
      return `${prefix}${salt.toString('base64url')}$${derived.toString('base64url')}`;
    },
    async verify(password, encoded) {
      if (!encoded.startsWith(prefix)) return false;
      const [saltText, hashText, extra] = encoded.slice(prefix.length).split('$');
      if (!saltText || !hashText || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(saltText + hashText)) return false;
      const salt = Buffer.from(saltText, 'base64url');
      const expected = Buffer.from(hashText, 'base64url');
      if (salt.length !== saltBytes || expected.length !== keyBytes || salt.toString('base64url') !== saltText || expected.toString('base64url') !== hashText) return false;
      return timingSafeEqual(await derive(password, salt), expected);
    },
  };
}
