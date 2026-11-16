import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { StoredResponse } from '../../shared/idempotency.js';
import { HttpError, errorSchema } from '../../shared/http/errors.js';
import type { createImportService, UploadPart } from './import.service.js';
import { datasetIdSchema, mappingRequestSchema, singleDatasetSchema, validationReportSchema } from './datasets.schema.js';
import type { MappingRequest } from './datasets.types.js';

const noQuery = { type: 'object', additionalProperties: false, properties: {} } as const;
const errors = (statuses: number[]) => Object.fromEntries(statuses.map(status => [status, errorSchema]));
const send = (reply: FastifyReply, response: StoredResponse) => reply.code(response.statusCode).send(response.body);
async function* uploadParts(request: FastifyRequest): AsyncGenerator<UploadPart> {
  for await (const part of request.parts()) {
    if (part.type === 'file') yield { type: 'file', fieldname: part.fieldname, filename: part.filename,
      mimetype: part.mimetype, stream: part.file, truncated: () => part.file.truncated };
    else yield { type: 'field', fieldname: part.fieldname, value: part.value };
  }
}
export function createImportRoutes(service: ReturnType<typeof createImportService>, timeoutMs: number): FastifyPluginAsync {
  return async app => {
    const authorize = app.authorize(['analyst', 'admin']);
    app.post('/datasets', {
      onRequest: authorize,
      schema: { querystring: noQuery, response: { 201: singleDatasetSchema, ...errors([400, 401, 403, 409, 413, 415, 422, 500, 503]) } },
    }, async (request, reply) => {
      if (!request.isMultipart()) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload requires multipart/form-data.');
      // Also bound an incomplete multipart envelope with no file stream to abort.
      const deadline = setTimeout(() => request.raw.destroy(), timeoutMs); deadline.unref();
      try {
        const response = await service.upload(request.principal!.id, request.headers['idempotency-key'], uploadParts(request));
        return send(reply, response);
      } finally { clearTimeout(deadline); }
    });
    app.get<{ Params: { id: string } }>('/datasets/:id/validation', {
      onRequest: authorize,
      schema: { params: datasetIdSchema, querystring: noQuery,
        response: { 200: validationReportSchema, ...errors([400, 401, 403, 404, 500]) } },
    }, async request => {
      try { return await service.validation(request.params.id); }
      catch (error) {
        if (error instanceof HttpError && error.statusCode < 500) throw error;
        throw new HttpError(500, 'VALIDATION_UNAVAILABLE', 'Validation report could not be read.');
      }
    });
    app.put<{ Params: { id: string }; Body: MappingRequest }>('/datasets/:id/mapping', {
      onRequest: authorize, config: { bodyValidationStatus: 422 },
      schema: { params: datasetIdSchema, querystring: noQuery, body: mappingRequestSchema,
        response: { 200: singleDatasetSchema, ...errors([400, 401, 403, 404, 409, 422, 500]) } },
    }, async request => ({ data: await service.mapping(request.params.id, request.body) }));
    app.post<{ Params: { id: string } }>('/datasets/:id/imports', {
      onRequest: authorize,
      schema: { params: datasetIdSchema, querystring: noQuery,
        response: { 200: singleDatasetSchema, ...errors([400, 401, 403, 404, 409, 422, 500, 503]) } },
    }, async (request, reply) => {
      if (request.body !== undefined) throw new HttpError(400, 'UNEXPECTED_BODY', 'Import does not accept a request body.');
      const response = await service.import(request.principal!.id, request.params.id, request.headers['idempotency-key']);
      return send(reply, response);
    });
  };
}
