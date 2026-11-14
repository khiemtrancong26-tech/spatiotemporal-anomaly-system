export const datasetQuerySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    sort: { type: 'string', enum: ['createdAt:asc', 'createdAt:desc'], default: 'createdAt:desc' },
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
    cursor: { type: 'string' },
  },
} as const;

export const importIssueSchema = {
  type: 'object', additionalProperties: false, required: ['rowNumber', 'reason'],
  properties: {
    rowNumber: { type: 'integer', minimum: 1 },
    reason: { type: 'string', enum: ['DUPLICATE_SAME_VALUE', 'DUPLICATE_VALUE_CONFLICT', 'INVALID_ROW'] },
    field: { type: 'string' }, keptRowNumber: { type: 'integer', minimum: 1 },
  },
} as const;
export const importSummarySchema = {
  type: 'object', additionalProperties: false,
  required: ['totalRows', 'importedRows', 'duplicateRows', 'conflictingRows', 'invalidRows', 'issues'],
  properties: {
    totalRows: { type: 'integer', minimum: 0 }, importedRows: { type: 'integer', minimum: 0 },
    duplicateRows: { type: 'integer', minimum: 0 }, conflictingRows: { type: 'integer', minimum: 0 },
    invalidRows: { type: 'integer', minimum: 0 }, issues: { type: 'array', items: importIssueSchema },
  },
} as const;
export const datasetSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'name', 'sourceFilename', 'status', 'createdBy', 'createdAt'],
  properties: {
    id: { type: 'string', minLength: 1 }, name: { type: 'string' }, sourceFilename: { type: 'string' },
    status: { type: 'string', enum: ['uploaded', 'awaiting_mapping', 'importing', 'imported', 'failed'] },
    createdBy: { type: 'string', minLength: 1 },
    createdAt: { type: 'string', format: 'date-time' }, importSummary: importSummarySchema,
  },
} as const;
export const datasetPageSchema = {
  type: 'object', additionalProperties: false, required: ['data', 'page'],
  properties: {
    data: { type: 'array', items: datasetSchema },
    page: {
      type: 'object', additionalProperties: false, required: ['limit', 'nextCursor'],
      properties: { limit: { type: 'integer', minimum: 1 }, nextCursor: { type: 'string', nullable: true } },
    },
  },
} as const;
