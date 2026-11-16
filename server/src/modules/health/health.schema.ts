export const healthResponseSchema = {
  type: 'object', additionalProperties: false, required: ['status', 'timestamp'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;
