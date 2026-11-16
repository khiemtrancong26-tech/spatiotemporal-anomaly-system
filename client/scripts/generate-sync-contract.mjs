
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

const client = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const source = path.resolve(client, '../docs/api/openapi.yaml');
const spec = YAML.parse(await readFile(source, 'utf8'));

const directory = path.join(
  client,
  'src/shared/api/generated',
);

await mkdir(directory, { recursive: true });

const syncEndpoints = [
  { route: '/api/v1/review-changes', method: 'get' },
  { route: '/api/v1/review-mutation-batches', method: 'post' },
  { route: '/api/v1/exports', method: 'get' },
];

const operations = {};
const references = new Set();

function collect(value) {
  if (!value || typeof value !== 'object') return;

  if (typeof value.$ref === 'string') {
    const name = value.$ref.split('/').at(-1);

    if (!references.has(name)) {
      references.add(name);

      const schema = spec.components?.schemas?.[name];

      if (!schema) {
        throw new Error(`Missing OpenAPI schema: ${name}`);
      }

      collect(schema);
    }
  }

  Object.values(value).forEach(collect);
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'nullable')
      .map(([key, val]) => [key, normalize(val)]),
  );

  return value.nullable
    ? { anyOf: [normalized, { type: 'null' }] }
    : normalized;
}

for (const { route, method } of syncEndpoints) {
  const operation = spec.paths?.[route]?.[method];

  if (!operation) {
    throw new Error(`Missing Sync endpoint: ${method.toUpperCase()} ${route}`);
  }

  if (!operation.operationId) {
    throw new Error(`Missing operationId: ${method.toUpperCase()} ${route}`);
  }

  collect(operation);

  const parameters = {};

  for (const location of ['path', 'query', 'header']) {
    const fields = (operation.parameters ?? [])
      .filter((parameter) => parameter.in === location);

    parameters[location] = {
      type: 'object',
      properties: Object.fromEntries(
        fields.map((parameter) => [
          parameter.name,
          parameter.schema,
        ]),
      ),
      required: fields
        .filter((parameter) => parameter.required)
        .map((parameter) => parameter.name),
      additionalProperties: false,
    };
  }

  const bodyEntry = Object.entries(
    operation.requestBody?.content ?? {},
  )[0];

  operations[operation.operationId] = {
    method: method.toUpperCase(),
    path: route,
    authenticated: (
      operation.security ?? spec.security ?? []
    ).length > 0,
    parameters,
    body: bodyEntry
      ? {
          contentType: bodyEntry[0],
          schema: bodyEntry[1].schema,
        }
      : null,
    responses: Object.fromEntries(
      Object.entries(operation.responses ?? {}).map(
        ([status, response]) => [
          status,
          response.content?.['application/json']?.schema ?? null,
        ],
      ),
    ),
  };
}

const expectedOperationIds = [
  'get_api_v1_review_changes',
  'post_api_v1_review_mutation_batches',
  'get_api_v1_exports',
];

for (const id of expectedOperationIds) {
  if (!operations[id]) {
    throw new Error(`Expected Sync operation was not generated: ${id}`);
  }
}

const schemas = Object.fromEntries(
  [...references]
    .sort()
    .map((name) => [name, spec.components.schemas[name]]),
);

const runtimeContract = normalize({
  components: { schemas },
  operations,
});

await writeFile(
  path.join(directory, 'sync-contract.json'),
  `${JSON.stringify(runtimeContract, null, 2)}\n`,
  'utf8',
);

const aliases = [...references]
  .sort()
  .map(
    (name) =>
      `export type ${name} = components['schemas']['${name}'];`,
  );

aliases.push(
  "export type ReviewChangesQuery = NonNullable<paths['/api/v1/review-changes']['get']['parameters']['query']>;",
  "export type ExportsQuery = NonNullable<paths['/api/v1/exports']['get']['parameters']['query']>;",
);

const wireSource = [
  '// Generated from docs/api/openapi.yaml. Do not edit manually.',
  "import type { components, paths } from './openapi';",
  ...aliases,
  '',
].join('\n');

await writeFile(
  path.join(directory, 'sync-wire.ts'),
  wireSource,
  'utf8',
);

console.log(
  `Generated ${Object.keys(operations).length} Sync operations and ${references.size} schemas.`,
);

console.log('Generated:');
console.log(' - src/shared/api/generated/sync-contract.json');
console.log(' - src/shared/api/generated/sync-wire.ts');
