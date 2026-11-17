import { userPublicSchema } from '../users/index.js';
export const adminCreateSchema = { type: 'object', additionalProperties: false, required: ['username', 'password', 'role'], properties: {
  username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 8 }, role: { type: 'string', enum: ['analyst', 'admin'] },
} } as const;
export const adminUpdateSchema = { type: 'object', additionalProperties: false, minProperties: 1, properties: {
  isActive: { type: 'boolean' }, role: { type: 'string', enum: ['analyst', 'admin'] },
} } as const;
export const adminQuerySchema = { type: 'object', additionalProperties: false, required: [], properties: {
  sort: { type: 'string', enum: ['username:asc', 'username:desc'], default: 'username:asc' },
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 }, cursor: { type: 'string' },
} } as const;
export const userPageSchema = { type: 'object', additionalProperties: false, required: ['data', 'page'], properties: {
  data: { type: 'array', items: userPublicSchema }, page: { type: 'object', additionalProperties: false, required: ['limit', 'nextCursor'], properties: {
    limit: { type: 'integer', minimum: 1 }, nextCursor: { type: 'string', nullable: true },
  } },
} } as const;
