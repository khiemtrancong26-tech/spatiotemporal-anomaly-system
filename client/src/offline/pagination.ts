import type { PageInfo } from '../shared/api/generated/wire';

export interface LocalPage<T> {
  data: T[];
  page: PageInfo;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && entry !== null)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Stable, non-cryptographic query fingerprint for local cursor scoping only. */
export function queryFingerprint(query: object): string {
  const { cursor: _cursor, ...withoutCursor } = query as Record<string, unknown>;
  const value = canonical(withoutCursor);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function makeLocalPage<T>(args: {
  rows: T[];
  query: { cursor?: string; limit?: number };
  queryKey: string;
  defaultLimit?: number;
}): LocalPage<T> {
  const limit = Math.max(1, Math.min(2_000, args.query.limit ?? args.defaultLimit ?? 100));
  const match = args.query.cursor?.match(/^offline-v1:([a-z0-9]+):(\d+)$/);
  const offset = match?.[1] === args.queryKey ? Number(match[2]) : 0;
  const data = args.rows.slice(offset, offset + limit);
  const nextOffset = offset + data.length;
  const nextCursor = nextOffset < args.rows.length
    ? `offline-v1:${args.queryKey}:${nextOffset}`
    : null;

  return { data, page: { limit, nextCursor } };
}

export function canUseOfflineFallback(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { kind?: unknown; status?: unknown };
  if (candidate.kind === 'network') return true;
  return candidate.kind === 'http' && [502, 503, 504].includes(Number(candidate.status));
}

export function isPageInfo(value: unknown): value is PageInfo {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<PageInfo>;
  return Number.isInteger(page.limit) && Number(page.limit) > 0 &&
    (page.nextCursor === null || typeof page.nextCursor === 'string');
}
