export interface Page<T> { data: T[]; page: { limit: number; nextCursor: string | null } }
export interface PagerState<T> {
  data: T[];
  nextCursor: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: unknown;
}
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, fingerprint(entry)])));
  return JSON.stringify(value);
}

/** Shared cursor lifecycle. Each dataset/filter/sort change invalidates pending responses. */
export function createCursorPager<T extends { id: string }, Q extends object>(
  load: (query: Q & { cursor?: string }, options: { signal: AbortSignal }) => Promise<Page<T>>,
) {
  let state: PagerState<T> = { data: [], nextCursor: null, status: 'idle' };
  let query: Q | undefined;
  let key: string | undefined;
  let generation = 0;
  let controller: AbortController | undefined;
  let pendingCursor: string | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PagerState<T>) => { state = next; listeners.forEach((fn) => fn()); };
  const fetchPage = async (cursor?: string) => {
    if (!query || state.status === 'loading') return;
    const current = generation;
    const active = new AbortController();
    controller = active;
    pendingCursor = cursor;
    publish({ ...state, status: 'loading', error: undefined });
    try {
      const page = await load({ ...query, cursor }, { signal: active.signal });
      if (current !== generation || active.signal.aborted) return;
      if (cursor && page.page.nextCursor === cursor) throw new Error('Server returned a repeated cursor.');
      const combined = cursor ? [...state.data, ...page.data] : page.data;
      const byId = new Map(combined.map((item) => [item.id, item]));
      publish({ data: [...byId.values()], nextCursor: page.page.nextCursor, status: 'ready' });
    } catch (error) {
      if (current === generation && !active.signal.aborted) publish({ ...state, status: 'error', error });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setQuery(next: Q) {
      const nextKey = fingerprint(next);
      if (nextKey === key) return Promise.resolve();
      key = nextKey;
      query = structuredClone(next);
      generation += 1;
      controller?.abort();
      publish({ data: [], nextCursor: null, status: 'idle' });
      return fetchPage();
    },
    loadMore: () => state.nextCursor ? fetchPage(state.nextCursor) : Promise.resolve(),
    retry: () => state.status === 'error' ? fetchPage(pendingCursor) : Promise.resolve(),
    dispose() { generation += 1; controller?.abort(); key = undefined; query = undefined; state = { data: [], nextCursor: null, status: 'idle' };  },
  };
}
