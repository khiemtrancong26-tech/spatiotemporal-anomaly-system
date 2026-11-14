import type { AnalysisRun, DetectionRequest } from '../shared/api/generated/wire';
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
  const runs = new Map<string, { run: AnalysisRun; acceptedAt: number; reads: number }>();
  const receipts = new Map<string, { body: string; response: { data: AnalysisRun } }>();
  // Demo accounts only. New mock accounts live in RAM until reload.
  const accounts = new Map<string, { username: string; digest: string }>();
  async function digest(password: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)))).join(','); }
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    await delay(controls.delayMs, init?.signal);
    if (controls.scenario === 'network-error') throw new TypeError('Synthetic network error');
    if (controls.scenario === 'malformed') return json({ unexpected: true });
    if (controls.scenario === 'server-error') return error(503, 'MOCK_UNAVAILABLE');
    const candidate = successCases.find((item) => item.method === method && !['analysis-detail-queued', 'analysis-detail-running', 'analysis-detail-failed'].includes(item.id) && matches(item.path, url.pathname));
    if (!candidate) return error(404, 'MOCK_ROUTE_NOT_FOUND');
    const bearer = new Headers(init?.headers).get('Authorization') ?? '';
    const mockToken = bearer.replace(/^Bearer /, '');
    const sessionRole = mockToken === 'mock-admin01' ? 'admin' : mockToken === 'mock-analyst01' || mockToken.startsWith('mock-registered:') ? 'analyst' : controls.role;
    if (url.pathname.startsWith('/api/v1/admin/') && sessionRole !== 'admin') return error(403, 'FORBIDDEN');
    if (!['/api/v1/health', '/api/v1/auth/tokens', '/api/v1/auth/register'].includes(url.pathname) && !bearer) return error(401, 'UNAUTHORIZED');
    const overrideId = controls.overrides?.[candidate.id];
    const selected: Fixture = overrideId ? fixtures.cases.find((item) => item.id === overrideId) ?? candidate : candidate;
    if (selected !== candidate) return json(selected.response, selected.status);

    if (url.pathname === '/api/v1/analysis-runs' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as DetectionRequest;
      const key = `${mockToken}:${new Headers(init?.headers).get('Idempotency-Key')}`;
      const prior = receipts.get(key);
      if (prior) return prior.body === JSON.stringify(body) ? json(prior.response, 202) : error(422, 'KEY_PAYLOAD_MISMATCH');
      const run: AnalysisRun = { id: `demo-${crypto.randomUUID()}`, datasetId: body.datasetId, family: body.family, method: body.method, config: body.config, scope: body.scope ?? {}, status: 'queued', createdAt: new Date().toISOString() };
      const response = { data: structuredClone(run) };
      receipts.set(key, { body: JSON.stringify(body), response });
      runs.set(run.id, { run, acceptedAt: Date.now(), reads: 0 });
      return json(response, 202);
    }
    if (url.pathname.startsWith('/api/v1/analysis-runs/') && method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      const record = runs.get(id);
      if (record) {
        record.reads++;
        const status = record.reads === 1 ? 'queued' : record.reads === 2 ? 'running' : 'completed';
        record.run = { ...record.run, status, ...(status === 'completed' ? { completedAt: new Date().toISOString(), engineVersion: 'mock-only' } : {}) };
        return json({ data: record.run });
      }
    }
    const payload = structuredClone(candidate.response) as Record<string, unknown>;
    const id = candidate.path.includes('{id}') ? decodeURIComponent(url.pathname.split('/')[candidate.path.split('/').indexOf('{id}')]) : undefined;
    const pathParams = candidate.request as { pathParams?: { id: string } };
    if (id && id !== pathParams.pathParams?.id) return error(404, 'NOT_FOUND');
    if (candidate.id === 'analysis-list') payload.data = [...(payload.data as object[]), ...[...runs.values()].map(record => record.run)];
    if (candidate.id === 'anomalies' && url.searchParams.get('analysisRunId')?.startsWith('demo-')) {
      const record = runs.get(url.searchParams.get('analysisRunId')!);
      if (!record) return error(404, 'NOT_FOUND');
      if (record.run.status !== 'completed') return error(409, 'RESULTS_NOT_READY');
      payload.data = controls.scenario === 'empty' ? [] : (payload.data as Record<string, unknown>[]).map(item => ({ ...item, datasetId: record.run.datasetId, analysisRunId: record.run.id, family: record.run.family, method: record.run.method }));
    }
    if (candidate.id === 'me') payload.data = { ...(payload.data as object), role: sessionRole, username: mockToken.startsWith('mock-registered:') ? decodeURIComponent(mockToken.slice('mock-registered:'.length)) : sessionRole === 'admin' ? 'admin01' : 'analyst01' };
    if (candidate.id === 'register') {
      const credentials = JSON.parse(String(init?.body));
      if (Object.keys(credentials).some((key) => !['username', 'password'].includes(key)) || typeof credentials.username !== 'string' || !credentials.username.trim() || typeof credentials.password !== 'string' || credentials.password.length < 8) return error(422, 'VALIDATION_ERROR');
      const username = credentials.username.trim();
      const normalized = username.toLowerCase();
      if (['analyst01', 'admin01', 'demo'].includes(normalized) || accounts.has(normalized)) return error(409, 'USERNAME_CONFLICT');
      const passwordDigest = await digest(credentials.password);
      if (accounts.has(normalized)) return error(409, 'USERNAME_CONFLICT');
      accounts.set(normalized, { username, digest: passwordDigest });
      return json({ data: { id: `mock-user-${encodeURIComponent(username)}`, username, role: 'analyst', isActive: true } }, 201);
    }
    if (candidate.id === 'login') {
      const credentials = JSON.parse(String(init?.body));
      const account = accounts.get(String(credentials.username).trim().toLowerCase());
      if (account) {
        if (account.digest !== await digest(credentials.password)) return error(401, 'INVALID_CREDENTIALS');
        payload.user = { ...(payload.user as object), username: account.username, role: 'analyst' };
        payload.accessToken = `mock-registered:${encodeURIComponent(account.username)}`;
      } else if (credentials.username !== 'demo') {
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
