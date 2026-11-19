import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import { profileResponseSchema, aggregationResponseSchema, profileQuerySchema, aggregationQuerySchema } from '../../src/modules/exploration/exploration.schema.js';
it('keeps C2 HTTP and strict shared DTOs aligned with the approved OpenAPI migration', async () => {
  const spec = parse(await readFile(new URL('../../../docs/api/openapi.yaml', import.meta.url), 'utf8'));
  function expand(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(expand);
    if (!input || typeof input !== 'object') return input;
    const v = input as Record<string, unknown>;
    if (typeof v.$ref === 'string') return expand({ ...spec.components.schemas[v.$ref.split('/').at(-1)!], ...(v.nullable ? { nullable: true } : {}) });
    if (v.anyOf) { const a = v.anyOf as Record<string, unknown>[]; if (a.length === 2 && a[1]!.type === 'null') return { ...(expand(a[0]) as object), nullable: true }; }
    if (v.type === 'array' && Array.isArray(v.items)) return { type: 'array', minItems: v.items.length, maxItems: v.items.length, items: { type: 'number' } };
    return Object.fromEntries(Object.entries(v).filter(([k]) => !['description', '$schema'].includes(k)).map(([k, val]) => {
      if (k === 'exclusiveMinimum' && val === 0 && v.type === 'integer') return ['minimum', 1];
      if (k === 'const') return ['enum', [val]];
      return [k, expand(val)];
    }));
  }
  for (const [path, query, response] of [['/api/v1/datasets/{id}/profile', profileQuerySchema, profileResponseSchema], ['/api/v1/reading-aggregates', aggregationQuerySchema, aggregationResponseSchema]] as const) {
    const operation = spec.paths[path].get;
    expect(expand(response)).toEqual(expand(operation.responses['200'].content['application/json'].schema));
    const parameters = operation.parameters.filter((p: { in: string }) => p.in === 'query');
    expect(query.required).toEqual(parameters.filter((p: { required?: boolean }) => p.required).map((p: { name: string }) => p.name));
    expect(expand(query.properties)).toEqual(expand(Object.fromEntries(parameters.map((p: { name: string; schema: unknown }) => [p.name, p.schema]))));
    expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(['200', '400', '401', '403', '405', '422', '500', '503']));
  }
});
