import { DataSourceError } from './errors';
import { conforms, errorSchema, operations, requireInput, type OperationId } from './validation';

export interface HttpOptions {
  baseUrl: string;
  getAccessToken: () => string | undefined;
  fetch: typeof globalThis.fetch;
}
export interface HttpRequest {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export function createHttpClient(options: HttpOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl) || new URL(baseUrl).pathname !== '/api/v1' || new URL(baseUrl).search || new URL(baseUrl).hash || new URL(baseUrl).username || new URL(baseUrl).password) {
    throw new TypeError('API base URL must be an HTTP(S) origin followed by /api/v1.');
  }
  return async function request<T>(id: OperationId, input: HttpRequest = {}): Promise<T> {
    const operation = operations[id];
    const pathParams = input.path ?? {};
    const query: Record<string, unknown> = { ...input.query };
    for (const [name, schema] of Object.entries(operation.parameters.query.properties ?? {})) {
      if (query[name] === undefined && schema.default !== undefined) query[name] = schema.default;
    }
    Object.keys(query).forEach((key) => { if (query[key] === undefined) delete query[key]; });
    const extraHeaders: Record<string, string> = input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {};
    requireInput(pathParams, operation.parameters.path, 'path parameters');
    requireInput(query, operation.parameters.query, 'query parameters');
    requireInput(extraHeaders, operation.parameters.header, 'request headers');

    const headers = new Headers({ Accept: 'application/json', ...extraHeaders });
    const token = options.getAccessToken();
    if (operation.authenticated && token) headers.set('Authorization', `Bearer ${token}`);
    let body: BodyInit | undefined;
    if (operation.body?.contentType === 'multipart/form-data') {
      const upload = input.body as { file?: unknown; name?: string } | undefined;
      if (!(upload?.file instanceof File)) throw new TypeError('Upload requires a File.');
      requireInput({ ...upload, file: 'binary' }, operation.body.schema, 'upload body');
      const form = new FormData();
      form.append('file', upload.file);
      if (upload.name !== undefined) form.append('name', upload.name);
      body = form; // Browser supplies the multipart boundary.
    } else if (operation.body) {
      requireInput(input.body, operation.body.schema, 'request body');
      body = JSON.stringify(input.body);
      headers.set('Content-Type', 'application/json');
    } else if (input.body !== undefined) throw new TypeError('This operation has no request body.');

    const suffix = operation.path.slice('/api/v1'.length).replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(pathParams[name]));
    const url = new URL(baseUrl + suffix);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    let response: Response;
    let payload: unknown;
    try {
      if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      response = await options.fetch(url, { method: operation.method, headers, body, signal: input.signal, cache: 'no-store' });
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new DataSourceError('aborted', 'Request aborted');
      throw new DataSourceError('network', 'Network request failed');
    }
    try { payload = await response.json(); }
    catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw new DataSourceError('aborted', 'Response aborted');
      if (error instanceof TypeError) throw new DataSourceError('network', 'Response stream failed');
      throw new DataSourceError('invalid-response', 'Expected JSON response', response.status);
    }
    if (input.signal?.aborted) throw new DataSourceError('aborted', 'Request aborted');
    if (!response.ok) {
      if (!conforms(payload, errorSchema)) throw new DataSourceError('invalid-response', 'Invalid error envelope', response.status);
      const apiError = (payload as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
      throw new DataSourceError('http', 'HTTP request failed', response.status, apiError);
    }
    const schema = operation.responses[String(response.status)];
    if (!schema || !conforms(payload, schema)) throw new DataSourceError('invalid-response', 'Invalid success envelope or status', response.status);
    return payload as T;
  };
}
