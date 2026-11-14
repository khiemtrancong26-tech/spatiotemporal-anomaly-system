import { HttpError } from './http/errors.js';

export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'A UUID Idempotency-Key is required.');
  }
  return value;
}

export interface IdempotencyIntent {
  userId: string;
  operation: string;
  key: string;
  requestHash: string;
}
export interface StoredResponse { statusCode: number; body: unknown }
export type IdempotencyClaim =
  | { outcome: 'claimed'; claimId: string }
  | { outcome: 'completed'; response: StoredResponse }
  | { outcome: 'processing' }
  | { outcome: 'payload_mismatch' };

/** B1 boundary only. A B3 design must guarantee atomic claims, effect/replay recovery and retention. */
export interface IdempotencyStore {
  claim: (intent: IdempotencyIntent) => Promise<IdempotencyClaim>;
  complete: (claimId: string, response: StoredResponse) => Promise<void>;
}

// Do not implement a misleading RAM store or automatic mutation retry here.
export function replayOrThrow(claim: Exclude<IdempotencyClaim, { outcome: 'claimed' }>): StoredResponse {
  if (claim.outcome === 'completed') return claim.response;
  if (claim.outcome === 'processing') throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'This operation is still being processed.');
  throw new HttpError(422, 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'The idempotency key was used with a different request.');
}
