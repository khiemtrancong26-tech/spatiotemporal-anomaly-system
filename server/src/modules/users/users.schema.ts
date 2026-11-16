export const userPublicSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'username', 'role', 'isActive'],
  properties: {
    id: { type: 'string', minLength: 1 }, username: { type: 'string' },
    role: { type: 'string', enum: ['analyst', 'admin'] }, isActive: { type: 'boolean' },
  },
} as const;
export const userResponseSchema = {
  type: 'object', additionalProperties: false, required: ['data'], properties: { data: userPublicSchema },
} as const;
