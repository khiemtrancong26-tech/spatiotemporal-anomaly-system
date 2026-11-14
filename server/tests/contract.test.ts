import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { healthResponseSchema } from '../src/modules/health/health.schema.js';
import { errorSchema } from '../src/shared/http/errors.js';
import { onlineIndexes } from '../src/shared/persistence/indexes.js';

describe('foundation contract drift checks', () => {
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
