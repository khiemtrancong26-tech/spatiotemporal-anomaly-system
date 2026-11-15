import { jwtVerify, SignJWT, errors } from 'jose';

const issuer = 'pm25-api';
const audience = 'pm25-web';
export function createTokens(secret: string, now: () => Date = () => new Date()) {
  const key = new TextEncoder().encode(secret);
  if (key.byteLength < 32) throw new Error('JWT secret must contain at least 32 bytes');
  return {
    async issue(subject: string) {
      const issuedAt = Math.floor(now().getTime() / 1000);
      return new SignJWT({}).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(subject)
        .setIssuer(issuer).setAudience(audience).setIssuedAt(issuedAt).setExpirationTime(issuedAt + 3600).sign(key);
    },
    async verify(token: string): Promise<string | null> {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer, audience,
          requiredClaims: ['sub', 'iat', 'exp'], currentDate: now(), typ: 'JWT',
        });
        return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
      } catch (error) {
        if (error instanceof errors.JOSEError) return null;
        throw error;
      }
    },
  };
}
