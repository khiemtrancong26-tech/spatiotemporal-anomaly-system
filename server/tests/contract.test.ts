import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { healthResponseSchema } from '../src/modules/health/health.schema.js';
import { errorSchema } from '../src/shared/http/errors.js';
import { onlineIndexes } from '../src/shared/persistence/indexes.js';
import { userPublicSchema, userResponseSchema } from '../src/modules/users/users.schema.js';
import { loginRequestSchema, loginResponseSchema, registerRequestSchema } from '../src/modules/auth/auth.schema.js';
import { datasetPageSchema, datasetSchema, importSummarySchema } from '../src/modules/datasets/datasets.schema.js';

describe('foundation contract drift checks', () => {
  it('keeps B2 request/response schemas aligned without tightening open DTO constraints', async () => {
    const spec = parse(await readFile(new URL('../../docs/api/openapi.yaml', import.meta.url), 'utf8'));
    function expand(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(expand);
      if (!value || typeof value !== 'object') return value;
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === 'string') return expand(spec.components.schemas[record.$ref.split('/').at(-1)!]);
      return Object.fromEntries(Object.entries(record).filter(([name]) => name !== 'description').map(([name, item]) => [name, expand(item)]));
    }
    for (const [name, schema] of Object.entries({ UserPublic: userPublicSchema, UserResponse: userResponseSchema,
      RegisterRequest: registerRequestSchema, LoginRequest: loginRequestSchema, LoginResponse: loginResponseSchema,
      Dataset: datasetSchema, DatasetPage: datasetPageSchema, ImportSummary: importSummarySchema,
    })) expect(expand(schema)).toEqual(expand(spec.components.schemas[name]));
  });
  it('keeps health and error schemas exactly aligned with the existing OpenAPI', async () => {
    const spec = parse(await readFile(new URL('../../docs/api/openapi.yaml', import.meta.url), 'utf8'));
    expect(healthResponseSchema).toEqual(spec.components.schemas.HealthResponse);
    expect(errorSchema).toEqual(spec.components.schemas.Error);
    expect(Object.keys(spec.paths['/api/v1/health'])).toEqual(['get']);
    expect(Object.keys(spec.paths['/api/v1/health'].get.responses)).toEqual(expect.arrayContaining(['200', '503', '405', '500']));
  });
  it('uses only the online subset of the documented MongoDB index script', async () => {
    const proposals: Record<string, unknown> = {};
    const script = await readFile(new URL('../../infra/mongo/indexes.js', import.meta.url), 'utf8');
    runInNewContext(script, {
      print: () => undefined,
      db: { getCollection: (collection: string) => ({ createIndex: (key: unknown, options: { name: string }) => {
        proposals[options.name] = { collection, key, ...options };
      } }) },
    });
    const names: string[] = [];
    for (const [collection, definitions] of Object.entries(onlineIndexes)) {
      for (const definition of definitions) {
        expect(definition.name).toBeDefined();
        names.push(definition.name!);
        expect({ collection, ...definition }).toEqual(proposals[definition.name!]);
      }
    }
    expect(names).not.toContain('ix_anomalies_sync_updated');
    expect(names).not.toContain('uq_mutations_client_id');
    expect(names).toHaveLength(11);
  });
});
