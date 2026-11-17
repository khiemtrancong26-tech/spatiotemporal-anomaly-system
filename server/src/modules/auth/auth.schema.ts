import { userPublicSchema } from '../users/index.js';

export const registerRequestSchema = {
  type: 'object', additionalProperties: false, required: ['username', 'password', 'email'],
  properties: { email: { type: 'string', minLength: 3, maxLength: 254 }, username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 8 } },
} as const;
export const loginRequestSchema = {
  type: 'object', additionalProperties: false, required: ['username', 'password'],
  properties: { username: { type: 'string', minLength: 1 }, password: { type: 'string', minLength: 1 } },
} as const;
export const loginResponseSchema = {
  type: 'object', additionalProperties: false, required: ['accessToken', 'tokenType', 'user'],
  properties: { accessToken: { type: 'string' }, tokenType: { type: 'string', enum: ['Bearer'] }, user: userPublicSchema },
} as const;

export const emailRequestSchema = { type: 'object', additionalProperties: false, required: ['email'], properties: { email: { type: 'string', minLength: 3, maxLength: 254 } } } as const;
export const tokenRequestSchema = { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', minLength: 1, maxLength: 256 } } } as const;
export const resetRequestSchema = { ...tokenRequestSchema, required: ['token', 'newPassword'], properties: { ...tokenRequestSchema.properties, newPassword: { type: 'string', minLength: 8 } } } as const;
export const authMessageSchema = { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } } as const;
