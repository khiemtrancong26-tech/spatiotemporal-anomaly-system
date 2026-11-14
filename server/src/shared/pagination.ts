import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http/errors.js';

export const listSorts = {
  datasets: ['createdAt:asc', 'createdAt:desc'],
  sensors: ['externalId:asc', 'externalId:desc'],
  readings: ['ts:asc', 'ts:desc'],
  analysisRuns: ['createdAt:asc', 'createdAt:desc'],
  anomalies: ['ts:asc', 'ts:desc'],
  users: ['username:asc', 'username:desc'],
} as const;

export function parsePageQuery(query: { limit?: unknown; sort?: unknown; cursor?: unknown }, allowed: readonly string[], defaultSort: string) {
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if ((query.limit !== undefined && !['string', 'number'].includes(typeof query.limit)) ||
      (typeof query.limit === 'string' && !/^\d+$/.test(query.limit)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new HttpError(400, 'INVALID_QUERY', 'Limit must be an integer between 1 and 200.');
  }
  const sort = query.sort ?? defaultSort;
  if (typeof sort !== 'string' || !allowed.includes(sort)) throw new HttpError(400, 'INVALID_QUERY', 'Unsupported sort.');
  if (query.cursor !== undefined && (typeof query.cursor !== 'string' || !query.cursor.length)) {
    throw new HttpError(400, 'INVALID_CURSOR', 'Invalid cursor.');
  }
  return { limit, sort, cursor: query.cursor as string | undefined };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    if (json === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Invalid fingerprint input');
    return json;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

export function queryFingerprint(operation: string, filters: Record<string, unknown>, sort: string): string {
  return createHash('sha256').update(canonical({ operation, filters, sort })).digest('hex');
}

export interface CursorBoundary { key: string; id: string }
export function createCursorCodec(secret: string) {
  if (Buffer.byteLength(secret) < 32) throw new Error('Cursor signing secret must contain at least 32 bytes');
  function signature(payload: string) { return createHmac('sha256', secret).update(payload).digest(); }
  return {
    encode(boundary: CursorBoundary, fingerprint: string): string {
      const payload = Buffer.from(JSON.stringify({ v: 1, fingerprint, ...boundary })).toString('base64url');
      return `${payload}.${signature(payload).toString('base64url')}`;
    },
    decode(cursor: string, fingerprint: string): CursorBoundary {
      const invalid = () => new HttpError(400, 'INVALID_CURSOR', 'Cursor is invalid or incompatible with this query.');
      if (cursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
      const [payload, encodedSignature] = cursor.split('.');
      if (!payload || !encodedSignature) throw invalid();
      const actual = Buffer.from(encodedSignature, 'base64url');
      const expected = signature(payload);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();
      try {
        const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!data || typeof data !== 'object') throw invalid();
        const record = data as Record<string, unknown>;
        if (record.v !== 1 || record.fingerprint !== fingerprint ||
            typeof record.key !== 'string' || !record.key || typeof record.id !== 'string' || !record.id) throw invalid();
        return { key: record.key, id: record.id };
      } catch { throw invalid(); }
    },
  };
}
