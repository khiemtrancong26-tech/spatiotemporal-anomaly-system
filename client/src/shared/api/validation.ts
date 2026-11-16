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
export type OperationId = keyof typeof contract.operations;
export const operations: Record<OperationId, Operation> = contract.operations;

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'pm25-contract', components: contract.components });
const validators = new WeakMap<object, ValidateFunction>();
export function conforms(value: unknown, schema: Schema): boolean {
  let validate = validators.get(schema);
  if (!validate) {
    // Each fragment retains the OpenAPI component reference base.
    validate = ajv.compile({ ...schema, components: contract.components } as AnySchema);
    validators.set(schema, validate);
  }
  return validate(value) as boolean;
}
export function requireInput(value: unknown, schema: Schema, label: string): void {
  if (!conforms(value, schema)) throw new TypeError(`Invalid ${label}; check the API contract.`);
}
export const errorSchema: Schema = { $ref: '#/components/schemas/Error' };
