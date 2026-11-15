import { userPublicSchema } from '../users/index.js';

export const registerRequestSchema = {
  type: 'object', additionalProperties: false, required: ['username', 'password'],
  properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 8 } },
} as const;
export const loginRequestSchema = {
  type: 'object', additionalProperties: false, required: ['username', 'password'],
  properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } },
} as const;
export const loginResponseSchema = {
  type: 'object', additionalProperties: false, required: ['accessToken', 'tokenType', 'user'],
  properties: { accessToken: { type: 'string' }, tokenType: { type: 'string', enum: ['Bearer'] }, user: userPublicSchema },
} as const;
