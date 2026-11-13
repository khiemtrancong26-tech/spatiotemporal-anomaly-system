import type { IdempotentOptions } from '../data-source/types';

function snapshot<T>(value: T): T {
  if (value instanceof File) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot)) as T;
  if (value !== null && typeof value === 'object') return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshot(entry)]))) as T;
  return value;
}

/** A new operation gets a new key. Retrying this object preserves its key AND payload. */
export function createIdempotentOperation<TInput, TOutput>(
  input: TInput,
  send: (input: TInput, options: IdempotentOptions) => Promise<TOutput>,
) {
  const payload = snapshot(input);
  const idempotencyKey = crypto.randomUUID();
  let pending: Promise<TOutput> | undefined;
  return {
    idempotencyKey,
    run(signal?: AbortSignal): Promise<TOutput> {
      if (pending) return pending;
      pending = Promise.resolve().then(() => send(payload, { idempotencyKey, signal })).finally(() => { pending = undefined; });
      return pending;
    },
  };
}
