import fixtures from '../../../docs/fixtures/frontend-online-examples.json';

export type MockScenario = 'success' | 'empty' | 'server-error' | 'network-error' | 'malformed';
export interface MockControls {
  scenario: MockScenario;
  delayMs: number;
  role: 'analyst' | 'admin';
  overrides?: Record<string, string>;
}
type Fixture = (typeof fixtures.cases)[number];
const successCases = fixtures.cases.filter((item) => item.status < 300);
function matches(template: string, path: string): boolean {
  return new RegExp('^' + template.replaceAll('{id}', '[^/]+') + '$').test(path);
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function error(status: number, code: string): Response {
  return json({ error: { code, message: 'Mock scenario' } }, status);
}
function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Fixture transport only: no service worker, network fallback, storage or background sync. */
export function createMockTransport(controls: MockControls): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    await delay(controls.delayMs, init?.signal);
    if (controls.scenario === 'network-error') throw new TypeError('Synthetic network error');
    if (controls.scenario === 'malformed') return json({ unexpected: true });
    if (controls.scenario === 'server-error') return error(503, 'MOCK_UNAVAILABLE');
    const candidate = successCases.find((item) => item.method === method && matches(item.path, url.pathname));
    if (!candidate) return error(404, 'MOCK_ROUTE_NOT_FOUND');
    if (url.pathname.startsWith('/api/v1/admin/') && !(new Headers(init?.headers).get('Authorization')?.includes('mock-admin01') || controls.role === 'admin')) return error(403, 'FORBIDDEN');
    if (url.pathname !== '/api/v1/health' && url.pathname !== '/api/v1/auth/tokens' && !new Headers(init?.headers).get('Authorization')) return error(401, 'UNAUTHORIZED');
    const overrideId = controls.overrides?.[candidate.id];
    const selected: Fixture = overrideId ? fixtures.cases.find((item) => item.id === overrideId) ?? candidate : candidate;
    if (selected !== candidate) return json(selected.response, selected.status);

    const payload = structuredClone(candidate.response) as Record<string, unknown>;
    const id = candidate.path.includes('{id}') ? decodeURIComponent(url.pathname.split('/')[candidate.path.split('/').indexOf('{id}')]) : undefined;
    const pathParams = candidate.request as { pathParams?: { id: string } };
    if (id && id !== pathParams.pathParams?.id) return error(404, 'NOT_FOUND');
    const bearer = new Headers(init?.headers).get('Authorization') ?? '';
    const sessionRole = bearer.includes('mock-admin01') ? 'admin' : bearer.includes('mock-analyst01') ? 'analyst' : controls.role;
    if (candidate.id === 'me') payload.data = { ...(payload.data as object), role: sessionRole, username: bearer.includes('mock-admin01') ? 'admin01' : 'analyst01' };
    if (candidate.id === 'login') {
      const credentials = JSON.parse(String(init?.body));
      if (credentials.username !== 'demo') {
        if (!['analyst01', 'admin01'].includes(credentials.username) || credentials.password !== 'demo-password') return error(401, 'INVALID_CREDENTIALS');
        const role = credentials.username === 'admin01' ? 'admin' : 'analyst';
        payload.user = { ...(payload.user as object), username: credentials.username, role };
        payload.accessToken = `mock-${credentials.username}`;
      } else payload.user = { ...(payload.user as object), role: controls.role };
    }
    if (Array.isArray(payload.data) && payload.page) {
      let rows = payload.data as Record<string, unknown>[];
      for (const field of ['datasetId', 'sensorId', 'analysisRunId', 'family', 'method', 'severity', 'status']) {
        const filter = url.searchParams.get(field);
        if (filter) rows = rows.filter((row) => row[field] === filter);
      }
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (from) rows = rows.filter((row) => Date.parse(String(row.ts)) >= Date.parse(from));
      if (to) rows = rows.filter((row) => Date.parse(String(row.ts)) <= Date.parse(to));
      const bounds = url.searchParams.get('bbox')?.split(',').map(Number);
      if (bounds) rows = rows.filter((row) => {
        const point = (row.location as { coordinates: number[] }).coordinates;
        return point[0] >= bounds[0] && point[0] <= bounds[2] && point[1] >= bounds[1] && point[1] <= bounds[3];
      });
      const [field, direction] = (url.searchParams.get('sort') ?? 'id:asc').split(':');
      rows.sort((a, b) => (String(a[field]).localeCompare(String(b[field])) || String(a.id).localeCompare(String(b.id))) * (direction === 'desc' ? -1 : 1));
      if (controls.scenario === 'empty') rows = [];
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const params = new URLSearchParams(url.searchParams);
      params.delete('cursor'); params.sort();
      const scope = url.pathname + '?' + params.toString();
      const cursor = url.searchParams.get('cursor');
      let offset = 0;
      if (cursor) {
        try {
          const parsed = JSON.parse(decodeURIComponent(cursor));
          if (parsed.scope !== scope || !Number.isInteger(parsed.offset) || parsed.offset < 0) return error(400, 'INVALID_CURSOR');
          offset = parsed.offset;
        } catch { return error(400, 'INVALID_CURSOR'); }
      }
      payload.data = rows.slice(offset, offset + limit);
      payload.page = { limit, nextCursor: offset + limit < rows.length ? encodeURIComponent(JSON.stringify({ scope, offset: offset + limit })) : null };
    }
    // Mutation payloads remain illustrative fixtures, not a stateful backend simulation.
    return json(payload, candidate.status);
  };
}
