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

export const datasetIdSchema = {
  type: 'object', additionalProperties: false, required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;
export const singleDatasetSchema = {
  type: 'object', additionalProperties: false, required: ['data'], properties: { data: datasetSchema },
} as const;
export const mappingRequestSchema = {
  type: 'object', additionalProperties: false, required: ['fieldMap', 'unit'],
  properties: {
    fieldMap: {
      type: 'object', additionalProperties: false, required: ['sensorId', 'latitude', 'longitude', 'timestamp', 'value'],
      properties: {
        sensorId: { type: 'string' }, latitude: { type: 'string' }, longitude: { type: 'string' },
        timestamp: { type: 'string' }, value: { type: 'string' }, unit: { type: 'string' },
        name: { type: 'string' }, region: { type: 'string' },
      },
    },
    unit: { type: 'string', enum: ['ug/m3'] },
  },
} as const;
export const validationReportSchema = {
  type: 'object', additionalProperties: false,
  required: ['datasetId', 'status', 'sourceColumns', 'totalRows', 'validRows', 'invalidRows', 'mappingSuggestions', 'issues'],
  properties: {
    datasetId: { type: 'string', minLength: 1 }, status: datasetSchema.properties.status,
    sourceColumns: { type: 'array', items: { type: 'string' } }, totalRows: { type: 'integer', minimum: 0 },
    validRows: { type: 'integer', minimum: 0 }, invalidRows: { type: 'integer', minimum: 0 },
    mappingSuggestions: { type: 'object', additionalProperties: { type: 'string' } },
    issues: { type: 'array', items: importIssueSchema },
  },
} as const;
