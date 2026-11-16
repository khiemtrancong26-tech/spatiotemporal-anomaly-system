
import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import contract from './generated/contract.json';

export interface Schema {
  type?: string;
  properties?: Record<string, Schema & { default?: unknown }>;
  [key: string]: unknown;
}

export interface Operation {
  method: string;
  path: string;
  authenticated: boolean;
  parameters: Record<'path' | 'query' | 'header', Schema>;
  body: { contentType: string; schema: Schema } | null;
  responses: Record<string, Schema | null>;
}

export interface ContractComponents {
  schemas: Record<string, unknown>;
}

export interface RuntimeContract {
  components: ContractComponents;
  operations: Record<string, Operation>;
}

export type OperationId = keyof typeof contract.operations;

export const operations: Record<OperationId, Operation> =
  contract.operations;

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

const validators = new WeakMap<
  object,
  WeakMap<object, ValidateFunction>
>();

export function conforms(
  value: unknown,
  schema: Schema,
  components: ContractComponents = contract.components,
): boolean {
  let byComponents = validators.get(schema);

  if (!byComponents) {
    byComponents = new WeakMap();
    validators.set(schema, byComponents);
  }

  let validate = byComponents.get(components);

  if (!validate) {
    validate = ajv.compile({
      ...schema,
      components,
    } as AnySchema);

    byComponents.set(components, validate);
  }

  return validate(value) as boolean;
}

export function requireInput(
  value: unknown,
  schema: Schema,
  label: string,
  components: ContractComponents = contract.components,
): void {
  if (!conforms(value, schema, components)) {
    throw new TypeError(
      `Invalid ${label}; check the API contract.`,
    );
  }
}

export const errorSchema: Schema = {
  $ref: '#/components/schemas/Error',
};
