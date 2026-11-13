import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';
import openapiTS, { astToString } from 'openapi-typescript';

const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(client, '../docs/api/openapi.yaml');
const spec = YAML.parse(await readFile(source, 'utf8'));
const directory = path.join(client, 'src/shared/api/generated');
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'openapi.d.ts'), astToString(await openapiTS(pathToFileURL(source))));

const excluded = new Set(['reading-aggregates', 'reading-batches', 'exports', 'review-changes', 'review-mutation-batches']);
const operations = {};
const references = new Set();
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) {
    const name = value.$ref.split('/').at(-1);
    if (!references.has(name)) { references.add(name); collect(spec.components.schemas[name]); }
  }
  Object.values(value).forEach(collect);
}
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  const normalized = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'nullable').map(([key, val]) => [key, normalize(val)]));
  return value.nullable ? { anyOf: [normalized, { type: 'null' }] } : normalized;
}
for (const [route, methods] of Object.entries(spec.paths)) {
  if (excluded.has(route.split('/').at(-1))) continue;
  for (const [method, operation] of Object.entries(methods)) {
    if (!['get', 'post', 'put', 'patch'].includes(method)) continue;
    collect(operation);
    const parameters = {};
    for (const location of ['query', 'path', 'header']) {
      const fields = (operation.parameters ?? []).filter((p) => p.in === location);
      parameters[location] = { type: 'object', properties: Object.fromEntries(fields.map((p) => [p.name, p.schema])), required: fields.filter((p) => p.required).map((p) => p.name), additionalProperties: false };
    }
    const bodyEntry = Object.entries(operation.requestBody?.content ?? {})[0];
    operations[operation.operationId] = {
      method: method.toUpperCase(), path: route,
      authenticated: (operation.security ?? spec.security ?? []).length > 0,
      parameters, body: bodyEntry ? { contentType: bodyEntry[0], schema: bodyEntry[1].schema } : null,
      responses: Object.fromEntries(Object.entries(operation.responses).map(([status, response]) => [status, response.content?.['application/json']?.schema ?? null])),
    };
  }
}
const schemas = Object.fromEntries([...references].sort().map((name) => [name, spec.components.schemas[name]]));
await writeFile(path.join(directory, 'contract.json'), JSON.stringify(normalize({ components: { schemas }, operations }), null, 2) + '\n');
const aliases = [...references].sort().map((name) => `export type ${name} = components['schemas']['${name}'];`);
const queries = { DatasetsQuery: 'datasets', SensorsQuery: 'sensors', ReadingsQuery: 'readings', AnalysisRunsQuery: 'analysis-runs', AnomaliesQuery: 'anomalies', AdminUsersQuery: 'admin/users' };
for (const [name, route] of Object.entries(queries)) aliases.push(`export type ${name} = NonNullable<paths['/api/v1/${route}']['get']['parameters']['query']>;`);
await writeFile(path.join(directory, 'wire.ts'), `// Generated from OpenAPI. Run npm run generate; do not edit.\nimport type { components, paths } from './openapi';\n${aliases.join('\n')}\n`);
console.log(`Generated ${Object.keys(operations).length} online operations and ${references.size} schemas.`);
